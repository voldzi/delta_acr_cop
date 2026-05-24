import type { FastifyReply, FastifyRequest } from "fastify";
import { createPublicKey, createVerify } from "node:crypto";
import { correlationIdFrom, sendError } from "./errors.js";

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
  authMode: "lab" | "oidc";
  displayName: string;
  email?: string;
  roles?: string[];
  subjectId: string;
  username: string;
}

interface JsonWebKeySet {
  keys?: Jwk[];
}

interface CachedJwks {
  expiresAt: number;
  keys: Jwk[];
}

type Jwk = JsonWebKey & {
  kid?: string;
};

const jwksCache = new Map<string, CachedJwks>();
const authClockSkewSeconds = 30;
const jwksCacheMs = 5 * 60 * 1000;

export async function requireBearerToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.url.startsWith("/health") || request.url === "/metrics") {
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
  if (!decoded || decoded.header.alg !== "RS256" || !decoded.header.kid) {
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
  const subjectId = decoded?.payload.sub?.trim();
  if (!decoded || !subjectId) {
    return null;
  }

  const username = decoded.payload.preferred_username?.trim()
    || decoded.payload.email?.trim()
    || decoded.payload.name?.trim()
    || subjectId;
  return {
    authMode: "oidc",
    displayName: decoded.payload.name?.trim() || username,
    ...(decoded.payload.email?.trim() ? { email: decoded.payload.email.trim() } : {}),
    roles: tokenRoles(decoded.payload),
    subjectId,
    username
  };
}

export function clearJwksCacheForTests(): void {
  jwksCache.clear();
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
  if (!readBoolean(process.env.COP_PUBLIC_READ_ENABLED)) {
    return false;
  }

  const method = request.method.toUpperCase();
  const path = request.url.split("?")[0] ?? request.url;
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
    || path === "/api/v1/cop/tracks"
    || path === "/api/v1/cop/conflicts"
    || path === "/api/v1/cop/track-history"
    || path === "/api/v1/stream/cop/health"
    || path.startsWith("/api/v1/stream/cop/")
    || path === "/api/v1/messaging/status"
    || path === "/api/v1/community/reports"
    || path.startsWith("/api/v1/community/reports/");
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
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  try {
    return {
      header: JSON.parse(base64UrlToBuffer(encodedHeader).toString("utf8")) as JwtHeader,
      payload: JSON.parse(base64UrlToBuffer(encodedPayload).toString("utf8")) as JwtPayload,
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

  try {
    const response = await fetch(jwksUri);
    if (!response.ok) {
      return [];
    }
    const jwks = await response.json() as JsonWebKeySet;
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    jwksCache.set(jwksUri, { expiresAt: Date.now() + jwksCacheMs, keys });
    return keys;
  } catch {
    return [];
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
