export type AuthMode = "lab" | "hybrid" | "oidc";
export type AuthStatus = "lab" | "anonymous" | "authenticating" | "authenticated" | "error";

export interface AuthConfig {
  clientId: string;
  issuer: string;
  mode: AuthMode;
  publicReadEnabled: boolean;
  scope: string;
  tokenEndpoint?: string;
}

export interface AuthProfile {
  email?: string;
  name: string;
  picture?: string;
  subjectId?: string;
  username: string;
}

export interface AuthSession {
  accessToken?: string;
  error?: string;
  expiresAt?: number;
  idToken?: string;
  profile?: AuthProfile;
  refreshToken?: string;
  status: AuthStatus;
}

export type AuthDiagnosticEventType =
  | "callback_error"
  | "login_succeeded"
  | "manual_logout"
  | "refresh_failed"
  | "refresh_started"
  | "refresh_succeeded"
  | "session_cleared"
  | "session_expired"
  | "session_missing"
  | "session_persisted"
  | "session_restored"
  | "storage_changed"
  | "storage_write_failed";

export interface AuthDiagnosticEvent {
  at: string;
  detail?: string;
  expiresAt?: number;
  hasRefreshToken?: boolean;
  status?: AuthStatus;
  storage?: "localStorage" | "sessionStorage" | "none";
  subjectId?: string;
  type: AuthDiagnosticEventType;
  username?: string;
}

export interface AuthStoredSessionSnapshot {
  expiresAt?: number;
  hasRefreshToken: boolean;
  profile?: AuthProfile;
  storage: "localStorage" | "sessionStorage" | "none";
}

export interface AuthDiagnostics {
  current: AuthStoredSessionSnapshot;
  events: AuthDiagnosticEvent[];
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  id_token?: string;
  refresh_expires_in?: number;
  refresh_token?: string;
  token_type?: string;
}

interface StoredAuthSession {
  accessToken: string;
  expiresAt: number;
  idToken?: string;
  profile?: AuthProfile;
  refreshToken?: string;
}

interface StoredCallbackState {
  expiresAt?: number;
  redirectUri: string;
  returnUrl: string;
  state: string;
  verifier: string;
}

const callbackStateKey = "cop.oidc.callback.v1";
const callbackStateFallbackKey = "cop.oidc.callback.fallback.v1";
const callbackStateCookieName = "cop_oidc_callback_v1";
const callbackStateTtlMs = 10 * 60 * 1000;
const sessionKey = "cop.oidc.session.v1";
const diagnosticsKey = "cop.oidc.diagnostics.v1";
const diagnosticsLimit = 40;

export const authSessionStorageKey = sessionKey;

export interface BeginLoginOptions {
  prompt?: "login";
}

export function readAuthConfig(): AuthConfig {
  return {
    clientId: import.meta.env.VITE_COP_OIDC_CLIENT_ID ?? "cop-web",
    issuer: normalizeIssuer(import.meta.env.VITE_COP_OIDC_ISSUER ?? ""),
    mode: readAuthMode(import.meta.env.VITE_COP_AUTH_MODE),
    publicReadEnabled: readBoolean(import.meta.env.VITE_COP_PUBLIC_READ_ENABLED ?? "true"),
    scope: import.meta.env.VITE_COP_OIDC_SCOPE ?? "openid profile email",
    tokenEndpoint: optionalString(import.meta.env.VITE_COP_OIDC_TOKEN_ENDPOINT)
  };
}

export function createInitialAuthSession(config: AuthConfig): AuthSession {
  if (!isOidcEnabled(config)) {
    return { status: "lab", profile: { name: "Lab operator", username: "lab" } };
  }
  const stored = readStoredSession();
  if (stored && stored.expiresAt > Date.now() + 30_000) {
    recordAuthDiagnosticEvent("session_restored", snapshotFromStoredSession(stored, detectedSessionStorage()));
    return { ...stored, status: "authenticated" };
  }
  if (stored) {
    recordAuthDiagnosticEvent("session_expired", snapshotFromStoredSession(stored, detectedSessionStorage()));
  } else {
    recordAuthDiagnosticEvent("session_missing", { storage: "none" });
  }
  return { status: "anonymous" };
}

export function isOidcEnabled(config: AuthConfig): boolean {
  return config.mode !== "lab" && Boolean(config.issuer && config.clientId);
}

export async function initializeAuth(config: AuthConfig): Promise<AuthSession> {
  if (!isOidcEnabled(config)) {
    return createInitialAuthSession(config);
  }

  const callback = readCallbackParams();
  if (callback.error) {
    recordAuthDiagnosticEvent("callback_error", { detail: callback.error });
    clearCallbackState();
    removeCallbackParams();
    return { status: "error", error: callback.error };
  }
  if (callback.code && callback.state) {
    return exchangeAuthorizationCode(config, callback.code, callback.state);
  }

  const stored = readStoredSession();
  if (!stored) {
    recordAuthDiagnosticEvent("session_missing", { storage: "none" });
    return { status: "anonymous" };
  }
  if (stored.expiresAt > Date.now() + 30_000) {
    recordAuthDiagnosticEvent("session_restored", snapshotFromStoredSession(stored, detectedSessionStorage()));
    return { ...stored, status: "authenticated" };
  }
  if (stored.refreshToken) {
    const refreshed = await refreshSession(config, stored.refreshToken);
    if (refreshed) {
      return refreshed;
    }
    recordAuthDiagnosticEvent("refresh_failed", snapshotFromStoredSession(stored, detectedSessionStorage()));
  }
  if (!shouldExpireAuthSessionAfterRefreshFailure(stored.expiresAt)) {
    return {
      ...stored,
      error: "Obnova přihlášení se dočasně nepodařila, zkusím to znovu.",
      status: "authenticated"
    };
  }
  clearStoredSession();
  return { status: "anonymous" };
}

export async function refreshAuthSession(config: AuthConfig, session?: AuthSession): Promise<AuthSession | null> {
  if (!isOidcEnabled(config)) {
    return null;
  }
  const refreshToken = session?.refreshToken ?? readStoredSession()?.refreshToken;
  if (!refreshToken) {
    return null;
  }
  return refreshSession(config, refreshToken);
}

export function hasOidcCallbackParams(): boolean {
  const callback = readCallbackParams();
  return Boolean(callback.code || callback.error);
}

export function getAuthorizationToken(session: AuthSession, labToken: string): string | undefined {
  if (isAuthSessionActive(session)) {
    return session.accessToken;
  }
  return session.status === "lab" ? labToken : undefined;
}

export function isAuthSessionActive(session: AuthSession, skewMs = 30_000): session is AuthSession & { accessToken: string } {
  return session.status === "authenticated"
    && Boolean(session.accessToken)
    && (!session.expiresAt || session.expiresAt > Date.now() + skewMs);
}

export function plannedAuthRefreshDelayMs(expiresAt: number, now = Date.now(), retryAttempt = 0): number {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    return 0;
  }
  if (retryAttempt > 0) {
    return Math.min(30_000, Math.max(2_000, remainingMs - 45_000));
  }
  const leadMs = remainingMs > 10 * 60_000
    ? 2 * 60_000
    : Math.max(20_000, Math.min(90_000, Math.floor(remainingMs * 0.7)));
  return Math.max(0, remainingMs - leadMs);
}

export function shouldRefreshAuthSessionOnResume(session: AuthSession, now = Date.now(), leadMs = 2 * 60_000): boolean {
  return session.status === "authenticated"
    && Boolean(session.refreshToken)
    && typeof session.expiresAt === "number"
    && session.expiresAt <= now + leadMs;
}

export function shouldExpireAuthSessionAfterRefreshFailure(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt !== "number" || expiresAt <= now + 5_000;
}

export async function beginLogin(config: AuthConfig, options: BeginLoginOptions = {}): Promise<void> {
  if (!isOidcEnabled(config)) {
    return;
  }

  const state = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const redirectUri = currentRedirectUri();
  writeCallbackState({ redirectUri, returnUrl: currentReturnUrl(), state, verifier });

  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  if (options.prompt) {
    url.searchParams.set("prompt", options.prompt);
  }
  window.location.assign(url.toString());
}

export function endSession(config: AuthConfig, session: AuthSession): void {
  recordAuthDiagnosticEvent("manual_logout", snapshotFromAuthSession(session));
  clearStoredSession();
  clearCallbackState();
  if (!isOidcEnabled(config)) {
    return;
  }

  const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", currentRedirectUri());
  if (session.idToken) {
    url.searchParams.set("id_token_hint", session.idToken);
  }
  window.location.assign(url.toString());
}

export function subjectIdFromAuthSession(session: AuthSession): string | undefined {
  return stableSubjectId(session.profile);
}

export function subjectIdFromStoredAuthValue(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StoredAuthSession>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.expiresAt !== "number") {
      return undefined;
    }
    return subjectIdFromStoredSession(parsed as StoredAuthSession);
  } catch {
    return undefined;
  }
}

export function readAuthDiagnostics(): AuthDiagnostics {
  return {
    current: readStoredSessionSnapshot(),
    events: readAuthDiagnosticEvents()
  };
}

export function recordAuthDiagnosticEvent(type: AuthDiagnosticEventType, input: Partial<AuthDiagnosticEvent> = {}): void {
  if (typeof window === "undefined") {
    return;
  }
  const event: AuthDiagnosticEvent = {
    at: new Date().toISOString(),
    detail: input.detail,
    expiresAt: input.expiresAt,
    hasRefreshToken: input.hasRefreshToken,
    status: input.status,
    storage: input.storage,
    subjectId: input.subjectId,
    type,
    username: input.username
  };
  try {
    const events = [...readAuthDiagnosticEvents(), event].slice(-diagnosticsLimit);
    window.localStorage.setItem(diagnosticsKey, JSON.stringify(events));
  } catch {
    try {
      const events = [...(readAuthDiagnosticEventsFrom(() => window.sessionStorage) ?? []), event].slice(-diagnosticsLimit);
      window.sessionStorage.setItem(diagnosticsKey, JSON.stringify(events));
    } catch {
      // Diagnostics must never interfere with authentication itself.
    }
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readAuthMode(value: unknown): AuthMode {
  return value === "oidc" || value === "hybrid" ? value : "lab";
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === "yes" || value === "on";
}

async function exchangeAuthorizationCode(config: AuthConfig, code: string, state: string): Promise<AuthSession> {
  const callbackState = readCallbackState();
  if (!callbackState || callbackState.state !== state) {
    clearCallbackState();
    removeCallbackParams();
    recordAuthDiagnosticEvent("callback_error", { detail: "callback state mismatch" });
    return { status: "error", error: "OIDC callback state does not match." };
  }

  const response = await fetch(oidcTokenEndpoint(config), {
    body: new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: callbackState.verifier,
      grant_type: "authorization_code",
      redirect_uri: callbackState.redirectUri
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  clearCallbackState();
  removeCallbackParams(callbackState.returnUrl);
  if (!response.ok) {
    recordAuthDiagnosticEvent("callback_error", { detail: `token exchange ${response.status}` });
    return { status: "error", error: `OIDC token exchange failed: ${response.status}` };
  }

  const session = persistTokenResponse(await response.json() as TokenResponse);
  recordAuthDiagnosticEvent("login_succeeded", snapshotFromAuthSession(session));
  return session;
}

async function refreshSession(config: AuthConfig, refreshToken: string): Promise<AuthSession | null> {
  recordAuthDiagnosticEvent("refresh_started", { hasRefreshToken: true });
  const response = await fetch(oidcTokenEndpoint(config), {
    body: new URLSearchParams({
      client_id: config.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });
  if (!response.ok) {
    recordAuthDiagnosticEvent("refresh_failed", { detail: `token refresh ${response.status}`, hasRefreshToken: true });
    return null;
  }
  const session = persistTokenResponse(await response.json() as TokenResponse, refreshToken);
  recordAuthDiagnosticEvent("refresh_succeeded", snapshotFromAuthSession(session));
  return session;
}

function persistTokenResponse(tokenResponse: TokenResponse, fallbackRefreshToken?: string): AuthSession {
  const payload = decodeJwtPayload(tokenResponse.access_token);
  const expiresAt = Date.now() + Math.max(30, tokenResponse.expires_in ?? 300) * 1000;
  const stored: StoredAuthSession = {
    accessToken: tokenResponse.access_token,
    expiresAt,
    idToken: tokenResponse.id_token,
    profile: profileFromPayload(payload),
    refreshToken: tokenResponse.refresh_token ?? fallbackRefreshToken
  };
  writeStoredSession(stored);
  return { ...stored, status: "authenticated" };
}

function profileFromPayload(payload: Record<string, unknown>): AuthProfile {
  const preferredUsername = optionalString(payload.preferred_username);
  const name = optionalString(payload.name) ?? preferredUsername ?? optionalString(payload.email) ?? "Operator";
  return {
    email: optionalString(payload.email),
    name,
    picture: optionalUrlString(payload.picture) ?? optionalUrlString(payload.avatar_url),
    subjectId: optionalString(payload.sub),
    username: preferredUsername ?? name
  };
}

function subjectIdFromStoredSession(session: Pick<StoredAuthSession, "profile"> | null): string | undefined {
  return session ? stableSubjectId(session.profile) : undefined;
}

function stableSubjectId(profile: AuthProfile | undefined): string | undefined {
  return profile?.subjectId ?? profile?.username ?? profile?.email;
}

function readStoredSession(): StoredAuthSession | null {
  return readStoredSessionFrom(() => window.localStorage)
    ?? readStoredSessionFrom(() => window.sessionStorage);
}

function detectedSessionStorage(): "localStorage" | "sessionStorage" | "none" {
  if (readStoredSessionFrom(() => window.localStorage)) {
    return "localStorage";
  }
  if (readStoredSessionFrom(() => window.sessionStorage)) {
    return "sessionStorage";
  }
  return "none";
}

function readStoredSessionSnapshot(): AuthStoredSessionSnapshot {
  const local = readStoredSessionFrom(() => window.localStorage);
  if (local) {
    return snapshotFromStoredSession(local, "localStorage");
  }
  const session = readStoredSessionFrom(() => window.sessionStorage);
  if (session) {
    return snapshotFromStoredSession(session, "sessionStorage");
  }
  return {
    hasRefreshToken: false,
    storage: "none"
  };
}

function snapshotFromAuthSession(session: AuthSession): Partial<AuthDiagnosticEvent> {
  return {
    expiresAt: session.expiresAt,
    hasRefreshToken: Boolean(session.refreshToken),
    status: session.status,
    subjectId: subjectIdFromAuthSession(session),
    username: session.profile?.username
  };
}

function snapshotFromStoredSession(
  session: Pick<StoredAuthSession, "expiresAt" | "profile" | "refreshToken">,
  storage: "localStorage" | "sessionStorage" | "none"
): AuthStoredSessionSnapshot & Partial<AuthDiagnosticEvent> {
  return {
    expiresAt: session.expiresAt,
    hasRefreshToken: Boolean(session.refreshToken),
    profile: session.profile,
    storage,
    subjectId: subjectIdFromStoredSession(session),
    username: session.profile?.username
  };
}

function readAuthDiagnosticEvents(): AuthDiagnosticEvent[] {
  return readAuthDiagnosticEventsFrom(() => window.localStorage)
    ?? readAuthDiagnosticEventsFrom(() => window.sessionStorage)
    ?? [];
}

function readAuthDiagnosticEventsFrom(getStorage: () => Storage): AuthDiagnosticEvent[] | null {
  try {
    const raw = getStorage().getItem(diagnosticsKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed
        .map(normalizeDiagnosticEvent)
        .filter((event): event is AuthDiagnosticEvent => Boolean(event))
      : null;
  } catch {
    return null;
  }
}

function normalizeDiagnosticEvent(value: unknown): AuthDiagnosticEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<AuthDiagnosticEvent>;
  if (typeof candidate.at !== "string" || typeof candidate.type !== "string") {
    return null;
  }
  return {
    at: candidate.at,
    detail: optionalString(candidate.detail),
    expiresAt: optionalNumber(candidate.expiresAt),
    hasRefreshToken: typeof candidate.hasRefreshToken === "boolean" ? candidate.hasRefreshToken : undefined,
    status: normalizeAuthStatus(candidate.status),
    storage: normalizeAuthStorage(candidate.storage),
    subjectId: optionalString(candidate.subjectId),
    type: normalizeDiagnosticEventType(candidate.type),
    username: optionalString(candidate.username)
  };
}

function normalizeDiagnosticEventType(value: string): AuthDiagnosticEventType {
  return [
    "callback_error",
    "login_succeeded",
    "manual_logout",
    "refresh_failed",
    "refresh_started",
    "refresh_succeeded",
    "session_cleared",
    "session_expired",
    "session_missing",
    "session_persisted",
    "session_restored",
    "storage_changed",
    "storage_write_failed"
  ].includes(value) ? value as AuthDiagnosticEventType : "session_missing";
}

function normalizeAuthStatus(value: unknown): AuthStatus | undefined {
  return value === "lab" || value === "anonymous" || value === "authenticating" || value === "authenticated" || value === "error"
    ? value
    : undefined;
}

function normalizeAuthStorage(value: unknown): AuthDiagnosticEvent["storage"] {
  return value === "localStorage" || value === "sessionStorage" || value === "none" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStoredSessionFrom(getStorage: () => Storage): StoredAuthSession | null {
  try {
    const raw = getStorage().getItem(sessionKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
    return typeof parsed.accessToken === "string" && typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt)
      ? parsed as StoredAuthSession
      : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredAuthSession): void {
  const serialized = JSON.stringify(session);
  let persisted = false;
  try {
    window.localStorage.setItem(sessionKey, serialized);
    persisted = true;
  } catch {
    // Some private/browser-managed contexts can deny localStorage. Fall back to sessionStorage.
  }
  try {
    window.sessionStorage.setItem(sessionKey, serialized);
    persisted = true;
  } catch {
    // If both stores fail, surface the error below.
  }
  if (!persisted) {
    recordAuthDiagnosticEvent("storage_write_failed", snapshotFromStoredSession(session, "none"));
    throw new Error("Prohlížeč neumožnil uložit přihlášení. Povolte site storage pro COP a zkuste to znovu.");
  }
  recordAuthDiagnosticEvent("session_persisted", snapshotFromStoredSession(session, detectedSessionStorage()));
}

function clearStoredSession(): void {
  try {
    window.localStorage.removeItem(sessionKey);
  } catch {
    // Best effort cleanup.
  }
  try {
    window.sessionStorage.removeItem(sessionKey);
  } catch {
    // Best effort cleanup.
  }
  recordAuthDiagnosticEvent("session_cleared", { storage: "none" });
}

function readCallbackParams(): { code?: string; error?: string; state?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get("code") ?? undefined,
    error: params.get("error_description") ?? params.get("error") ?? undefined,
    state: params.get("state") ?? undefined
  };
}

function readCallbackState(): StoredCallbackState | null {
  return readCallbackStateFrom(() => window.sessionStorage, callbackStateKey)
    ?? readCallbackStateFrom(() => window.localStorage, callbackStateFallbackKey, true)
    ?? readCallbackStateFromCookie();
}

function readCallbackStateFrom(getStorage: () => Storage, key: string, enforceExpiry = false): StoredCallbackState | null {
  try {
    const storage = getStorage();
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredCallbackState>;
    if (!isStoredCallbackState(parsed)) {
      return null;
    }
    if (enforceExpiry && typeof parsed.expiresAt === "number" && parsed.expiresAt < Date.now()) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCallbackState(value: StoredCallbackState): void {
  const fallbackValue = {
    ...value,
    expiresAt: Date.now() + callbackStateTtlMs
  };
  let persisted = false;
  try {
    window.sessionStorage.setItem(callbackStateKey, JSON.stringify(value));
    persisted = true;
  } catch {
    // Continue with the bounded localStorage fallback below.
  }
  try {
    window.localStorage.setItem(callbackStateFallbackKey, JSON.stringify(fallbackValue));
    persisted = true;
  } catch {
    // If both browser stores are unavailable, the login cannot be completed safely.
  }
  try {
    writeCallbackStateCookie(fallbackValue);
    persisted = persisted || Boolean(readCallbackStateFromCookie());
  } catch {
    // A short-lived cookie is only a last-resort fallback for embedded browsers.
  }
  if (!persisted) {
    throw new Error("Prohlížeč neumožnil uložit dočasný stav přihlášení. Povolte site storage pro COP a zkuste to znovu.");
  }
}

function clearCallbackState(): void {
  try {
    window.sessionStorage.removeItem(callbackStateKey);
  } catch {
    // Best effort cleanup.
  }
  try {
    window.localStorage.removeItem(callbackStateFallbackKey);
  } catch {
    // Best effort cleanup.
  }
  try {
    clearCallbackStateCookie();
  } catch {
    // Best effort cleanup.
  }
}

function isStoredCallbackState(value: Partial<StoredCallbackState>): value is StoredCallbackState {
  return typeof value.redirectUri === "string" &&
    typeof value.returnUrl === "string" &&
    typeof value.state === "string" &&
    typeof value.verifier === "string";
}

function readCallbackStateFromCookie(): StoredCallbackState | null {
  try {
    const raw = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${callbackStateCookieName}=`))
      ?.slice(callbackStateCookieName.length + 1);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<StoredCallbackState>;
    if (!isStoredCallbackState(parsed)) {
      return null;
    }
    if (typeof parsed.expiresAt === "number" && parsed.expiresAt < Date.now()) {
      clearCallbackStateCookie();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCallbackStateCookie(value: StoredCallbackState): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAgeSeconds = Math.floor(callbackStateTtlMs / 1000);
  document.cookie = `${callbackStateCookieName}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function clearCallbackStateCookie(): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${callbackStateCookieName}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

function removeCallbackParams(returnUrl?: string): void {
  if (returnUrl) {
    window.history.replaceState({}, document.title, returnUrl);
    return;
  }

  const url = new URL(window.location.href);
  ["code", "state", "session_state", "error", "error_description", "iss"].forEach((name) => url.searchParams.delete(name));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function currentRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function currentReturnUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return decodeURIComponent(
    Array.from(atob(base64))
      .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("")
  );
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/u, "");
}

function oidcTokenEndpoint(config: AuthConfig): string {
  return config.tokenEndpoint?.trim() || `${config.issuer}/protocol/openid-connect/token`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalUrlString(value: unknown): string | undefined {
  const candidate = optionalString(value);
  if (!candidate) {
    return undefined;
  }
  return /^(data:image\/|https?:\/\/|mxc:\/\/)/iu.test(candidate) ? candidate : undefined;
}
