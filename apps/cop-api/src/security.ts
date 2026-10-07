import type { FastifyReply, FastifyRequest } from "fastify";
import { createPublicKey, createVerify, type JsonWebKey as NodeJsonWebKey } from "node:crypto";
import { correlationIdFrom, sendError } from "./errors.js";
import { readBoundedBody } from "./bounded-upstream.js";

type AuthMode = "lab" | "hybrid" | "oidc";

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

export interface JwtPayload {
  aud?: string | string[];
  azp?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iat?: number;
  iss?: string;
  name?: string;
  nbf?: number;
  preferred_username?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
  sub?: string;
}

export interface AuthenticatedActor {
  issuer?: string;
  emailVerified?: boolean;
  authMode: "lab" | "oidc";
  displayName: string;
  email?: string;
  roles?: string[];
  subjectId: string;
  username: string;
}

interface CachedJwks {
  expiresAt: number;
  keys: Jwk[];
}

type Jwk = NodeJsonWebKey & {
  kid?: string;
};

const jwksCache = new Map<string, CachedJwks>();
const jwksInFlight = new Map<string, Promise<Jwk[]>>();
const authClockSkewSeconds = 30;
const jwksCacheMs = 5 * 60 * 1000;
const jwksFailureCacheMs = 1000;
const jwksTimeoutMs = 5000;
const jwksMaxBytes = 256 * 1024;

export async function requireBearerToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // CORS handles preflight without credentials before the application handler.
  if (request.method === "OPTIONS") return;
  if (request.url.startsWith("/health") || request.url === "/metrics") {
    return;
  }
  // The BFF endpoints authenticate with an HttpOnly COP session cookie. They must
  // remain outside the bearer-token guard because the browser never receives an
  // OAuth token in this mode.
  if (request.url.split("?")[0]?.startsWith("/api/v1/auth/")) {
    return;
  }

  const token = readBearerToken(request.headers.authorization);
  if (token) {
    if (isLabTokenAllowed(token)) {
      return;
    }

    if (isOidcMode() && await verifyOidcToken(token)) {
      return;
    }

    return unauthorized(request, reply);
  }

  if (request.headers.authorization) {
    return unauthorized(request, reply);
  }

  if (isPublicReadRequest(request)) {
    return;
  }

  return unauthorized(request, reply);
}

export async function verifyOidcToken(token: string): Promise<boolean> {
  const issuer = normalizeIssuer(process.env.COP_OIDC_ISSUER ?? "");
  if (!issuer) {
    return false;
  }

  const decoded = decodeJwt(token);
  if (!decoded || !validJwtClaims(decoded.payload)) {
    return false;
  }
  if (decoded.header.alg !== "RS256") {
    return false;
  }
  if (!decoded.header.kid) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (decoded.payload.iss !== issuer) {
    return false;
  }
  if (!decoded.payload.exp || decoded.payload.exp <= nowSeconds - authClockSkewSeconds) {
    return false;
  }
  if (decoded.payload.nbf && decoded.payload.nbf > nowSeconds + authClockSkewSeconds) {
    return false;
  }
  if (!matchesAllowedClient(decoded.payload)) {
    return false;
  }
  if (!matchesRequiredRole(decoded.payload)) {
    return false;
  }

  const key = await findJwkForToken(issuer, decoded.header.kid);
  if (!key) {
    return false;
  }

  return verifyJwtSignature(token, key);
}

export function actorFromRequest(request: FastifyRequest): AuthenticatedActor | null {
  const token = readBearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }

  if (isLabTokenAllowed(token)) {
    return {
      authMode: "lab",
      displayName: "Lab operator",
      subjectId: "lab",
      username: "lab"
    };
  }

  if (!isOidcMode()) {
    return null;
  }

  const decoded = decodeJwt(token);
  const subjectId = typeof decoded?.payload.sub === "string" ? decoded.payload.sub.trim() : undefined;
  if (!decoded || !subjectId) {
    return null;
  }

  const username = decoded.payload.preferred_username?.trim()
    || decoded.payload.email?.trim()
    || decoded.payload.name?.trim()
    || subjectId;
  return {
    authMode: "oidc",
    issuer: decoded.payload.iss,
    emailVerified: decoded.payload.email_verified === true,
    displayName: decoded.payload.name?.trim() || username,
    ...(decoded.payload.email?.trim() ? { email: decoded.payload.email.trim() } : {}),
    roles: tokenRoles(decoded.payload),
    subjectId,
    username
  };
}

export function clearJwksCacheForTests(): void {
  jwksCache.clear();
  jwksInFlight.clear();
}

function isLabTokenAllowed(token: string): boolean {
  const mode = readAuthMode();
  if (mode === "oidc" || process.env.COP_ALLOW_LAB_TOKEN === "false") {
    return false;
  }

  const expected = process.env.COP_LAB_TOKEN ?? "dev-lab-token";
  return token === expected;
}

function isOidcMode(): boolean {
  const mode = readAuthMode();
  return mode === "oidc" || mode === "hybrid";
}

function readAuthMode(): AuthMode {
  const value = process.env.COP_AUTH_MODE;
  return value === "oidc" || value === "hybrid" ? value : "lab";
}

function isPublicReadRequest(request: FastifyRequest): boolean {
  const method = request.method.toUpperCase();
  const path = request.url.split("?")[0] ?? request.url;
  if ((method === "GET" || method === "HEAD") && isCommunityMediaTicketRequest(request.url, path)) {
    return true;
  }
  if ((method === "GET" || method === "HEAD") && isMobilePairingPublicRequest(path)) {
    return true;
  }
  if (method === "POST" && path === "/_matrix/push/v1/notify") {
    return true;
  }

  if (!readBoolean(process.env.COP_PUBLIC_READ_ENABLED)) {
    return false;
  }

  if (path === "/api/v1/map/query" && method === "POST") {
    return true;
  }
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  return path === "/api/v1/sources"
    || path.startsWith("/api/v1/sources/")
    || path === "/api/v1/sources/health"
    || path === "/api/v1/flight-data/airports"
    || path === "/api/v1/geocode/search"
    || path === "/api/v1/map/catalog"
    || path === "/api/v1/map/raster-overlay"
    || path.startsWith("/api/v1/safety/hydro/stations/")
    || path.startsWith("/api/v1/transit/stops/")
    || path.startsWith("/api/v1/transit/vehicles/")
    || path.startsWith("/api/v1/weather-forecast/areas/")
    || path.startsWith("/api/v1/weather-stations/")
    || path === "/api/v1/weather-radar/frames"
    || path === "/api/v1/weather/webcam-proxy"
    || path === "/api/v1/cop/tracks"
    || path === "/api/v1/cop/conflicts"
    || path === "/api/v1/cop/track-history"
    || path === "/api/v1/stream/cop/health"
    || path.startsWith("/api/v1/stream/cop/")
    || path === "/api/v1/messaging/status"
    || path === "/api/v1/push/web/config"
    || path === "/api/v1/community/reports"
    || path.startsWith("/api/v1/community/reports/")
    || path === "/api/v1/sketch/palettes"
    || path === "/api/v1/sketch/drawings"
    || path.startsWith("/api/v1/sketch/drawings/");
}

function isMobilePairingPublicRequest(path: string): boolean {
  return path === "/.well-known/apple-app-site-association" || path.startsWith("/mobile/pair/");
}

function isCommunityMediaTicketRequest(url: string, path: string): boolean {
  if (!path.startsWith("/api/v1/community/reports/") || !path.includes("/attachments/") || !path.endsWith("/content")) {
    return false;
  }
  const query = url.split("?")[1] ?? "";
  return new URLSearchParams(query).has("mediaToken");
}

function readBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function readBearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/iu.exec(authorization ?? "");
  return match?.[1]?.trim() || null;
}

function unauthorized(request: FastifyRequest, reply: FastifyReply): void {
  sendError(
    reply,
    401,
    "UNAUTHORIZED",
    "Missing or invalid bearer token.",
    correlationIdFrom(request.headers["x-correlation-id"])
  );
}

export function decodeJwt(token: string): { header: JwtHeader; payload: JwtPayload; signedContent: string; signature: Buffer } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  try {
    const header: unknown = JSON.parse(base64UrlToBuffer(encodedHeader).toString("utf8"));
    const payload: unknown = JSON.parse(base64UrlToBuffer(encodedPayload).toString("utf8"));
    if (!jwtRecord(header) || !jwtRecord(payload)) return null;
    return {
      header: header as JwtHeader,
      payload: payload as JwtPayload,
      signature: base64UrlToBuffer(encodedSignature),
      signedContent: `${encodedHeader}.${encodedPayload}`
    };
  } catch {
    return null;
  }
}

async function findJwkForToken(issuer: string, kid: string): Promise<Jwk | null> {
  const jwksUri = process.env.COP_OIDC_JWKS_URI ?? `${issuer}/protocol/openid-connect/certs`;
  const jwks = await fetchJwks(jwksUri);
  return jwks.find((key) => key.kid === kid) ?? null;
}

async function fetchJwks(jwksUri: string): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const inFlight = jwksInFlight.get(jwksUri);
  if (inFlight) return inFlight;
  const pending = loadJwks(jwksUri);
  jwksInFlight.set(jwksUri, pending);
  try {
    return await pending;
  } finally {
    if (jwksInFlight.get(jwksUri) === pending) jwksInFlight.delete(jwksUri);
  }
}

async function loadJwks(jwksUri: string): Promise<Jwk[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), jwksTimeoutMs);
  try {
    // The configured identity provider is fixed server-side; never follow a
    // redirect to a different issuer or keep authentication waiting forever.
    const response = await fetch(jwksUri, { redirect: "error", signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("OIDC signing keys are unavailable.");
    }
    const jwks: unknown = JSON.parse((await readBoundedBody(response, jwksMaxBytes)).toString("utf8"));
    if (!jwtRecord(jwks) || !Array.isArray(jwks.keys)) throw new Error("Invalid OIDC signing keys.");
    const keys = jwks.keys.filter((key): key is Jwk => jwtRecord(key)
      && key.kty === "RSA"
      && typeof key.kid === "string"
      && (key.alg === undefined || key.alg === "RS256")
      && (key.use === undefined || key.use === "sig"));
    jwksCache.set(jwksUri, { expiresAt: Date.now() + jwksCacheMs, keys });
    return keys;
  } catch {
    // Fail closed and coalesce outage traffic without extending an expired key.
    jwksCache.set(jwksUri, { expiresAt: Date.now() + jwksFailureCacheMs, keys: [] });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function verifyJwtSignature(token: string, key: Jwk): boolean {
  const decoded = decodeJwt(token);
  if (!decoded) {
    return false;
  }

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(decoded.signedContent);
    verifier.end();
    return verifier.verify(createPublicKey({ format: "jwk", key }), decoded.signature);
  } catch {
    return false;
  }
}

function jwtRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Claims are untrusted until signature verification; malformed types must fail
// authentication rather than throw or get coerced by the time/role checks.
function validJwtClaims(payload: JwtPayload): boolean {
  const values = payload as Record<string, unknown>;
  for (const field of ["iss", "azp", "sub", "email", "name", "preferred_username"]) {
    if (values[field] !== undefined && typeof values[field] !== "string") return false;
  }
  for (const field of ["exp", "iat", "nbf"]) {
    if (values[field] !== undefined && (typeof values[field] !== "number" || !Number.isFinite(values[field]))) return false;
  }
  if (values.email_verified !== undefined && typeof values.email_verified !== "boolean") return false;
  const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (values.aud !== undefined && typeof values.aud !== "string" && !strings(values.aud)) return false;
  const access = (value: unknown) => jwtRecord(value) && (value.roles === undefined || strings(value.roles));
  if (values.realm_access !== undefined && !access(values.realm_access)) return false;
  if (values.resource_access !== undefined && (!jwtRecord(values.resource_access) || !Object.values(values.resource_access).every(access))) return false;
  return true;
}

function matchesAllowedClient(payload: JwtPayload): boolean {
  const allowedClients = readCsv(process.env.COP_OIDC_ALLOWED_CLIENTS ?? process.env.COP_OIDC_CLIENT_ID ?? process.env.COP_OIDC_AUDIENCE);
  if (allowedClients.length === 0) {
    return true;
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  return allowedClients.some((client) => payload.azp === client || audiences.includes(client));
}

function matchesRequiredRole(payload: JwtPayload): boolean {
  const requiredRole = process.env.COP_OIDC_REQUIRED_ROLE?.trim();
  if (!requiredRole) {
    return true;
  }

  const clientId = process.env.COP_OIDC_CLIENT_ID?.trim();
  const realmRoles = payload.realm_access?.roles ?? [];
  const clientRoles = clientId ? payload.resource_access?.[clientId]?.roles ?? [] : [];
  return realmRoles.includes(requiredRole) || clientRoles.includes(requiredRole);
}

function tokenRoles(payload: JwtPayload): string[] {
  const clientId = process.env.COP_OIDC_CLIENT_ID?.trim();
  return Array.from(new Set([
    ...(payload.realm_access?.roles ?? []),
    ...(clientId ? payload.resource_access?.[clientId]?.roles ?? [] : [])
  ]));
}

function readCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/u, "");
}
