import { createHash, createHmac } from "node:crypto";

export interface MediaUploadRequest {
  attachmentId: string;
  byteSize: number;
  contentType: string;
  fileName?: string;
  reportId: string;
}

export interface MediaUploadSlot {
  bucket: string;
  expiresAt: string;
  headers: Record<string, string>;
  method: "PUT";
  objectKey: string;
  uploadUrl: string;
}

export interface MediaStorage {
  readonly name: string;
  close(): Promise<void>;
  diagnostics?(): string | undefined;
  init(): Promise<void>;
  createUploadSlot(request: MediaUploadRequest, now: Date): Promise<MediaUploadSlot>;
}

interface S3MediaStorageConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  secretAccessKey: string;
  uploadExpiresSeconds: number;
}

export function createMediaStorageFromEnv(env: Record<string, string | undefined> = process.env): MediaStorage | undefined {
  const mode = (env.COP_MEDIA_STORE ?? "disabled").trim().toLowerCase();
  if (mode === "disabled" || mode === "none" || mode === "off") {
    return undefined;
  }
  if (mode !== "s3" && mode !== "seaweedfs") {
    throw new Error(`Unsupported COP_MEDIA_STORE value: ${mode}`);
  }

  const endpoint = requiredEnv(env, "COP_MEDIA_S3_ENDPOINT");
  const publicEndpoint = env.COP_MEDIA_S3_PUBLIC_ENDPOINT?.trim() || endpoint;
  return new S3PresignedMediaStorage({
    accessKeyId: requiredEnv(env, "COP_MEDIA_S3_ACCESS_KEY_ID"),
    bucket: requiredEnv(env, "COP_MEDIA_S3_BUCKET"),
    endpoint,
    publicEndpoint,
    region: env.COP_MEDIA_S3_REGION?.trim() || "us-east-1",
    secretAccessKey: requiredEnv(env, "COP_MEDIA_S3_SECRET_ACCESS_KEY"),
    uploadExpiresSeconds: readPositiveInteger(env.COP_MEDIA_UPLOAD_EXPIRES_SECONDS, 900)
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
  contentType: string;
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
  method: "HEAD" | "PUT";
  region: string;
  secretAccessKey: string;
  timestamp: Date;
}

async function signedS3Request(input: SignedS3RequestInput): Promise<Response> {
  const endpoint = new URL(input.endpoint);
  const amzDate = formatAmzDate(input.timestamp);
  const dateScope = amzDate.slice(0, 8);
  const credentialScope = `${dateScope}/${input.region}/s3/aws4_request`;
  const urlPath = joinUrlPath(endpoint.pathname, input.bucket);
  const headers: Record<string, string> = {
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": amzDate
  };
  const { canonicalHeaders, signedHeaders } = canonicalHeaderBlock({
    host: endpoint.host,
    ...headers
  });
  const canonicalRequest = [
    input.method,
    urlPath,
    "",
    canonicalHeaders,
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
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`${endpoint.origin}${urlPath}`, {
    headers: {
      ...headers,
      authorization
    },
    method: input.method
  });
}

function presignPutUrl(input: PresignPutUrlInput): string {
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
    "PUT",
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
