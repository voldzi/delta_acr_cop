import { createHash, createHmac } from "node:crypto";
import { readBoundedBody } from "./bounded-upstream.js";

export interface MediaUploadRequest {
  attachmentId: string;
  byteSize: number;
  contentType: string;
  fileName?: string;
  reportId: string;
}

export interface MediaObjectReadRequest {
  objectKey: string;
}

export interface MediaObjectWriteRequest {
  body: Buffer;
  contentType: string;
  objectKey: string;
}

export interface MediaObjectReadResult {
  body: Buffer;
  contentType?: string;
}

export interface MediaUploadSlot {
  bucket: string;
  expiresAt: string;
  headers: Record<string, string>;
  method: "PUT" | "POST";
  /** COP API upload uses ordinary user authentication, not an object-store grant. */
  transport?: "cop_api";
  objectKey: string;
  uploadUrl: string;
}

export interface MediaStorage {
  readonly name: string;
  close(): Promise<void>;
  diagnostics?(): string | undefined;
  init(): Promise<void>;
  createUploadSlot(request: MediaUploadRequest, now: Date): Promise<MediaUploadSlot>;
  createReadUrl(request: MediaObjectReadRequest, now: Date): Promise<string>;
  getObject(request: MediaObjectReadRequest, now: Date): Promise<MediaObjectReadResult>;
  putObject(request: MediaObjectWriteRequest, now: Date): Promise<void>;
  /** Deletes exactly an already verified owner manifest object, then checks its
   * absence. Unsupported/versioned storage remains pending, never completed. */
  eraseVerifiedObject?(request: { bucket: string; objectKey: string }, now: Date, signal: AbortSignal): Promise<"absent" | "pending">;
  verifiedErasureReady?(): Promise<boolean>;
}
export interface MediaUploadSettlementVerifier {
  /** Actual provider/runtime proof that all possible write paths are governed,
   * including any legacy presigned credentials; never a static policy label. */
  ready(bucket: string, signal: AbortSignal): Promise<boolean>;
  /** Verify a durable write gate and no unsettled admitted upload for this exact
   * object. Signature expiry alone cannot prove an already started PUT ended. */
  verify(request: { bucket: string; objectKey: string }, signal: AbortSignal): Promise<boolean>;
}

interface S3MediaStorageConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  secretAccessKey: string;
  uploadExpiresSeconds: number;
  uploadSettlement?: MediaUploadSettlementVerifier;
  uploadTransport?: "presigned" | "cop_api";
  copPublicOrigin?: string;
}

export function createMediaStorageFromEnv(env: Record<string, string | undefined> = process.env, options: { uploadSettlement?: MediaUploadSettlementVerifier } = {}): MediaStorage | undefined {
  const mode = (env.COP_MEDIA_STORE ?? "disabled").trim().toLowerCase();
  if (mode === "disabled" || mode === "none" || mode === "off") {
    return undefined;
  }
  if (mode !== "s3" && mode !== "seaweedfs") {
    throw new Error(`Unsupported COP_MEDIA_STORE value: ${mode}`);
  }

  const uploadTransport = (env.COP_MEDIA_UPLOAD_TRANSPORT ?? "presigned").trim();
  if (uploadTransport !== "presigned" && uploadTransport !== "cop_api") throw new Error("Invalid COP_MEDIA_UPLOAD_TRANSPORT");
  const copPublicOrigin = uploadTransport === "cop_api" ? configuredCopOrigin(requiredEnv(env, "COP_PUBLIC_URL")) : undefined;
  const endpoint = requiredEnv(env, "COP_MEDIA_S3_ENDPOINT");
  const publicEndpoint = env.COP_MEDIA_S3_PUBLIC_ENDPOINT?.trim() || endpoint;
  return new S3PresignedMediaStorage({
    accessKeyId: requiredEnv(env, "COP_MEDIA_S3_ACCESS_KEY_ID"),
    bucket: requiredEnv(env, "COP_MEDIA_S3_BUCKET"),
    endpoint,
    publicEndpoint,
    region: env.COP_MEDIA_S3_REGION?.trim() || "us-east-1",
    secretAccessKey: requiredEnv(env, "COP_MEDIA_S3_SECRET_ACCESS_KEY"),
    uploadExpiresSeconds: readPositiveInteger(env.COP_MEDIA_UPLOAD_EXPIRES_SECONDS, 900),
    uploadTransport,
    ...(copPublicOrigin ? { copPublicOrigin } : {}),
    ...(options.uploadSettlement ? { uploadSettlement: options.uploadSettlement } : {})
  });
}

export class S3PresignedMediaStorage implements MediaStorage {
  readonly name = "s3-presigned";

  constructor(private readonly config: S3MediaStorageConfig) {}

  async init(): Promise<void> {
    new URL(this.config.endpoint);
    new URL(this.config.publicEndpoint);
    await this.ensureBucket();
  }

  async close(): Promise<void> {}

  diagnostics(): string {
    const endpoint = new URL(this.config.endpoint);
    return `bucket=${this.config.bucket}; endpoint=${endpoint.origin}`;
  }

  async createUploadSlot(request: MediaUploadRequest, now: Date): Promise<MediaUploadSlot> {
    const objectKey = communityObjectKey(request);
    const expiresAt = new Date(now.getTime() + this.config.uploadExpiresSeconds * 1000).toISOString();
    if (this.config.uploadTransport === "cop_api") {
      const origin = configuredCopOrigin(this.config.copPublicOrigin ?? "");
      return { bucket: this.config.bucket, expiresAt, method: "POST", transport: "cop_api",
        headers: { "content-type": request.contentType }, objectKey,
        uploadUrl: new URL(`/api/v1/community/reports/${encodeURIComponent(request.reportId)}/attachments/${encodeURIComponent(request.attachmentId)}/upload`, origin).href };
    }
    return {
      bucket: this.config.bucket,
      expiresAt,
      headers: {
        "content-type": request.contentType
      },
      method: "PUT",
      objectKey,
      uploadUrl: presignPutUrl({
        accessKeyId: this.config.accessKeyId,
        bucket: this.config.bucket,
        contentType: request.contentType,
        endpoint: this.config.publicEndpoint,
        expiresSeconds: this.config.uploadExpiresSeconds,
        objectKey,
        region: this.config.region,
        secretAccessKey: this.config.secretAccessKey,
        timestamp: now
      })
    };
  }

  async createReadUrl(request: MediaObjectReadRequest, now: Date): Promise<string> {
    return presignUrl({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      expiresSeconds: this.config.uploadExpiresSeconds,
      method: "GET",
      objectKey: request.objectKey,
      region: this.config.region,
      secretAccessKey: this.config.secretAccessKey,
      timestamp: now
    });
  }

  async getObject(request: MediaObjectReadRequest, now: Date): Promise<MediaObjectReadResult> {
    const readUrl = await this.createReadUrl(request, now);
    const response = await fetch(readUrl);
    if (!response.ok) {
      throw new Error(`object read failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      body: Buffer.from(await response.arrayBuffer()),
      ...(contentType ? { contentType } : {})
    };
  }

  async putObject(request: MediaObjectWriteRequest, now: Date): Promise<void> {
    const uploadUrl = presignUrl({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      contentType: request.contentType,
      endpoint: this.config.endpoint,
      expiresSeconds: this.config.uploadExpiresSeconds,
      method: "PUT",
      objectKey: request.objectKey,
      region: this.config.region,
      secretAccessKey: this.config.secretAccessKey,
      timestamp: now
    });
    const response = await fetch(uploadUrl, {
      body: new Uint8Array(request.body),
      headers: {
        "content-type": request.contentType
      },
      method: "PUT"
    });
    if (!response.ok) {
      throw new Error(`object upload failed with HTTP ${response.status}`);
    }
  }

  async eraseVerifiedObject(request: { bucket: string; objectKey: string }, now: Date, signal: AbortSignal): Promise<"absent" | "pending"> {
    signal.throwIfAborted();
    if (request.bucket !== this.config.bucket || !isExactCommunityObjectKey(request.objectKey) || !this.config.uploadSettlement) return "pending";
    const input = { accessKeyId: this.config.accessKeyId, bucket: this.config.bucket, endpoint: this.config.endpoint,
      region: this.config.region, secretAccessKey: this.config.secretAccessKey, timestamp: now,
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) };
    try {
      if (!await this.config.uploadSettlement.verify(request, input.signal)) return "pending";
      // A DELETE in a versioned bucket only creates a delete marker. Refuse both
      // enabled and suspended versioning until a version inventory adapter exists.
      const versioning = await signedS3Request({ ...input, method: "GET", query: { versioning: "" } });
      if (!versioning.ok) { await versioning.body?.cancel(); return "pending"; }
      const body = (await readBoundedBody(versioning, 4096)).toString("utf8");
      if (!isVerifiedUnversionedResponse(body)) return "pending";
      const deleted = await signedS3Request({ ...input, method: "DELETE", objectKey: request.objectKey });
      await deleted.body?.cancel();
      if (!deleted.ok && deleted.status !== 404) return "pending";
      const readback = await signedS3Request({ ...input, method: "HEAD", objectKey: request.objectKey });
      await readback.body?.cancel(); signal.throwIfAborted();
      if (readback.status !== 404 || !await this.config.uploadSettlement.verify(request, input.signal)) return "pending";
      // Verify absence after the final settlement witness, so a PUT that settled
      // between the first HEAD and the witness cannot leave a recreated object.
      input.signal.throwIfAborted(); const settledReadback = await signedS3Request({ ...input, method: "HEAD", objectKey: request.objectKey });
      await settledReadback.body?.cancel(); input.signal.throwIfAborted(); signal.throwIfAborted();
      return settledReadback.status === 404 ? "absent" : "pending";
    } catch {
      signal.throwIfAborted();
      return "pending";
    }
  }
  async verifiedErasureReady(): Promise<boolean> {
    if (!this.config.uploadSettlement) return false;
    try {
      const signal = AbortSignal.timeout(5000);
      if (!await this.config.uploadSettlement.ready(this.config.bucket, signal)) return false;
      const response = await signedS3Request({ accessKeyId: this.config.accessKeyId, bucket: this.config.bucket, endpoint: this.config.endpoint,
        region: this.config.region, secretAccessKey: this.config.secretAccessKey, timestamp: new Date(), method: "GET", query: { versioning: "" }, signal });
      if (!response.ok) { await response.body?.cancel(); return false; }
      return isVerifiedUnversionedResponse((await readBoundedBody(response, 4096)).toString("utf8"));
    } catch { return false; }
  }

  private async ensureBucket(): Promise<void> {
    const headResponse = await signedS3Request({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      method: "HEAD",
      region: this.config.region,
      secretAccessKey: this.config.secretAccessKey,
      timestamp: new Date()
    });
    if (headResponse.ok) {
      return;
    }
    if (headResponse.status !== 404) {
      throw new Error(`bucket ${this.config.bucket} check failed with HTTP ${headResponse.status}`);
    }

    const createResponse = await signedS3Request({
      accessKeyId: this.config.accessKeyId,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint,
      method: "PUT",
      region: this.config.region,
      secretAccessKey: this.config.secretAccessKey,
      timestamp: new Date()
    });
    if (createResponse.ok || createResponse.status === 409) {
      return;
    }
    throw new Error(`bucket ${this.config.bucket} create failed with HTTP ${createResponse.status}`);
  }
}

interface PresignPutUrlInput {
  accessKeyId: string;
  bucket: string;
  contentType?: string;
  endpoint: string;
  expiresSeconds: number;
  objectKey: string;
  region: string;
  secretAccessKey: string;
  timestamp: Date;
}

interface SignedS3RequestInput {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  method: "HEAD" | "PUT" | "GET" | "DELETE";
  objectKey?: string;
  query?: Record<string, string>;
  signal?: AbortSignal;
  region: string;
  secretAccessKey: string;
  timestamp: Date;
}

async function signedS3Request(input: SignedS3RequestInput): Promise<Response> {
  const endpoint = new URL(input.endpoint);
  const amzDate = formatAmzDate(input.timestamp);
  const dateScope = amzDate.slice(0, 8);
  const credentialScope = `${dateScope}/${input.region}/s3/aws4_request`;
  const urlPath = joinUrlPath(endpoint.pathname, input.bucket, ...(input.objectKey ? [input.objectKey] : []));
  const query = canonicalQueryString(input.query ?? {});
  const payloadHash = sha256Hex("");
  const headers: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  const { canonicalHeaders, signedHeaders } = canonicalHeaderBlock({
    host: endpoint.host,
    ...headers
  });
  const canonicalRequest = [
    input.method,
    urlPath,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmacHex(signingKey(input.secretAccessKey, dateScope, input.region), stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`${endpoint.origin}${urlPath}${query ? "?" + query : ""}`, {
    headers: {
      ...headers,
      authorization
    },
    method: input.method,
    redirect: "error",
    ...(input.signal ? { signal: input.signal } : {})
  });
}

function isExactCommunityObjectKey(value: string): boolean {
  // Match the server's communityObjectKey path grammar. No prefix deletion,
  // normalization, path traversal, caller URL, or cross-bucket request is used.
  return /^community-reports\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/(?:[A-Za-z0-9_.-]+|derivatives\/xr-sbs\.mp4)$/u.test(value)
    && !value.split("/").some(segment => segment === "." || segment === "..");
}

function isVerifiedUnversionedResponse(value: string): boolean {
  // The only accepted S3 result is the defined empty VersioningConfiguration.
  // An unsupported API, malformed XML, entity/DTD, unknown element or Status is
  // conservatively pending. No XML entities or external resources are parsed.
  return /^\s*(?:<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*)?<VersioningConfiguration\s+xmlns=["']http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/["']\s*(?:\/>|>\s*<\/VersioningConfiguration>)\s*$/u.test(value);
}

function presignPutUrl(input: PresignPutUrlInput): string {
  return presignUrl({ ...input, method: "PUT" });
}

function presignUrl(input: PresignPutUrlInput & { method: "GET" | "PUT" }): string {
  const endpoint = new URL(input.endpoint);
  const amzDate = formatAmzDate(input.timestamp);
  const dateScope = amzDate.slice(0, 8);
  const credentialScope = `${dateScope}/${input.region}/s3/aws4_request`;
  const urlPath = joinUrlPath(endpoint.pathname, input.bucket, input.objectKey);
  const signedHeaders = "host";
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders
  };
  const canonicalQuery = canonicalQueryString(query);
  const canonicalRequest = [
    input.method,
    urlPath,
    canonicalQuery,
    `host:${endpoint.host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmacHex(signingKey(input.secretAccessKey, dateScope, input.region), stringToSign);
  return `${endpoint.origin}${urlPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function canonicalHeaderBlock(headers: Record<string, string>): { canonicalHeaders: string; signedHeaders: string } {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/gu, " ")] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonicalHeaders: entries.map(([key, value]) => `${key}:${value}\n`).join(""),
    signedHeaders: entries.map(([key]) => key).join(";")
  };
}

function communityObjectKey(request: MediaUploadRequest): string {
  const fileName = safeFileName(request.fileName ?? `${request.attachmentId}.bin`);
  return `community-reports/${request.reportId}/${request.attachmentId}/${fileName}`;
}

function safeFileName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\w.-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "")
    .slice(0, 96);
  return normalized || "attachment.bin";
}

function joinUrlPath(...parts: string[]): string {
  const segments = parts
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean)
    .map(encodePathSegment);
  return `/${segments.join("/")}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatAmzDate(value: Date): string {
  return value.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

function signingKey(secretAccessKey: string, dateScope: string, region: string): Buffer {
  const kDate = hmacBuffer(`AWS4${secretAccessKey}`, dateScope);
  const kRegion = hmacBuffer(kDate, region);
  const kService = hmacBuffer(kRegion, "s3");
  return hmacBuffer(kService, "aws4_request");
}

function hmacBuffer(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required when COP_MEDIA_STORE=s3.`);
  }
  return value;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function configuredCopOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("COP API media uploads require a fixed HTTPS COP_PUBLIC_URL origin");
  return url.origin;
}
