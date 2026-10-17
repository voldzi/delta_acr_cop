import type { AuthConfig, AuthSession } from "./auth";

const path = "/api/v1/me/account-deletion";
const deletionScope = "cop_sim_shared_identity_v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const domains = [
  "keycloak",
  "cop_sessions_profiles",
  "cop_devices",
  "messaging_matrix",
  "voice_livekit",
  "cop_content_media",
  "mobility_dispatch",
  "sim_measurements",
  "ai_router",
  "moderation_audit",
  "backup_restore"
];
type Json = Record<string, unknown>;
export interface DeletionPreflight {
  operationId: string;
  canConfirm: boolean;
  planId?: string;
  confirmBy?: string;
  blockers: { domain: string; reason: string }[];
}
export interface DeletionIdentity {
  readonly subjectId: string;
  readonly issuer: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
}
export interface BoundDeletionPreflight extends DeletionPreflight {
  readonly identity: DeletionIdentity;
}
export interface DeletionReceipt {
  operationId: string;
  status: "deleting" | "deleted";
  accountDeleted: boolean;
  remaining: string[];
}
export class DeletionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DeletionRequestError(503, "INVALID_REPLY");
  return value as Json;
}
function operation(value: string): string {
  if (!uuid.test(value)) throw new DeletionRequestError(400, "INVALID_OPERATION");
  return value.toLowerCase();
}
export function parseDeletionPreflight(value: unknown, operationId: string): DeletionPreflight {
  const v = object(value);
  if (
    v.contractVersion !== "cop-account-erasure-preflight-v2" ||
    v.deletionScope !== deletionScope ||
    v.operationId !== operation(operationId) ||
    typeof v.canConfirm !== "boolean" ||
    !Array.isArray(v.blockers)
  )
    throw new DeletionRequestError(503, "INVALID_REPLY");
  const blockers = v.blockers.map((entry) => {
    const b = object(entry);
    if (
      typeof b.domain !== "string" ||
      !domains.includes(b.domain) ||
      typeof b.reason !== "string" ||
      !["ownership_unresolved", "choice_required", "adapter_preflight_missing", "adapter_unavailable"].includes(
        b.reason
      )
    )
      throw new DeletionRequestError(503, "INVALID_REPLY");
    return { domain: b.domain, reason: b.reason };
  });
  if (v.canConfirm) {
    if (
      blockers.length ||
      typeof v.planId !== "string" ||
      !uuid.test(v.planId) ||
      typeof v.confirmBy !== "string" ||
      !Number.isFinite(Date.parse(v.confirmBy))
    )
      throw new DeletionRequestError(503, "INVALID_REPLY");
    return {
      operationId: operation(operationId),
      canConfirm: true,
      planId: v.planId,
      confirmBy: v.confirmBy,
      blockers
    };
  }
  if (!blockers.length) throw new DeletionRequestError(503, "INVALID_REPLY");
  return { operationId: operation(operationId), canConfirm: false, blockers };
}
export function parseDeletionReceipt(value: unknown, operationId: string, status: number): DeletionReceipt {
  const v = object(value),
    id = operation(operationId);
  if (
    v.contractVersion !== "cop-account-erasure-v2" ||
    v.deletionScope !== deletionScope ||
    v.operationId !== id ||
    v.revocationEnforced !== true ||
    !Array.isArray(v.remaining) ||
    v.remaining.some((d) => typeof d !== "string" || !domains.includes(d)) ||
    new Set(v.remaining).size !== v.remaining.length ||
    typeof v.requestedAt !== "string" ||
    !Number.isFinite(Date.parse(v.requestedAt))
  )
    throw new DeletionRequestError(503, "INVALID_REPLY");
  const completed =
    v.status === "deleted" &&
    v.accountDeleted === true &&
    v.remaining.length === 0 &&
    typeof v.completedAt === "string" &&
    Number.isFinite(Date.parse(v.completedAt));
  const pending = v.status === "deleting" && v.accountDeleted === false && v.remaining.length > 0;
  if ((!completed && !pending) || (status === 202 && !pending) || (status !== 200 && status !== 202))
    throw new DeletionRequestError(503, "INVALID_REPLY");
  return {
    operationId: id,
    status: completed ? "deleted" : "deleting",
    accountDeleted: completed,
    remaining: v.remaining as string[]
  };
}
async function request(relativePath: string, session?: AuthSession, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (session?.transport !== "bff" && session?.accessToken && session.accessToken !== "cop-bff-session")
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  const response = await fetch(relativePath, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  const reader = response.body?.getReader();
  if (!reader) throw new DeletionRequestError(503, "INVALID_REPLY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > (response.ok ? 320_000 : 16_384)) {
        void reader.cancel().catch(() => {});
        throw new DeletionRequestError(503, "INVALID_REPLY");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DeletionRequestError(503, "INVALID_REPLY");
  }
  if (!response.ok) {
    const v = object(value),
      e = object(v.error);
    throw new DeletionRequestError(
      response.status,
      typeof e.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(e.code) ? e.code : "UNAVAILABLE"
    );
  }
  return { status: response.status, value, headers: response.headers };
}
export async function deletionAvailable(session: AuthSession): Promise<boolean> {
  const { status, value } = await request(path + "/capabilities", session),
    v = object(value);
  if (status !== 200 || v.contractVersion !== "cop-account-erasure-v2" || typeof v.accountDeletion !== "boolean")
    throw new DeletionRequestError(503, "INVALID_REPLY");
  return v.accountDeletion;
}
function boundedIdentityText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}
export function sameDeletionIdentity(left: DeletionIdentity, right: DeletionIdentity): boolean {
  return (
    left.subjectId === right.subjectId &&
    left.issuer === right.issuer &&
    left.displayName === right.displayName &&
    left.email === right.email &&
    left.emailVerified === right.emailVerified
  );
}
export async function readDeletionIdentity(session: AuthSession, config: AuthConfig): Promise<DeletionIdentity> {
  const expectedIssuer = config.issuer.replace(/\/$/u, "");
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(expectedIssuer);
  } catch {
    throw new DeletionRequestError(503, "ACCOUNT_IDENTITY_UNAVAILABLE");
  }
  if (
    config.mode === "lab" ||
    issuerUrl.protocol !== "https:" ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash ||
    session.status !== "authenticated" ||
    !boundedIdentityText(session.profile?.subjectId, 512) ||
    (session.expiresAt !== undefined && session.expiresAt <= Date.now())
  )
    throw new DeletionRequestError(503, "ACCOUNT_IDENTITY_UNAVAILABLE");
  const { status, value, headers } = await request("/api/v1/me/profile", session);
  const v = object(value);
  const allowed = [
    "contractVersion",
    "subjectId",
    "issuer",
    "displayName",
    "email",
    "emailVerified",
    "avatarDataUrl",
    "revision",
    "updatedAt",
    "serverTimestamp"
  ];
  if (
    status !== 200 ||
    v.contractVersion !== "cop-account-profile-v1" ||
    Object.keys(v).length !== allowed.length ||
    Object.keys(v).some((key) => !allowed.includes(key)) ||
    !headers
      .get("Cache-Control")
      ?.split(",")
      .some((directive) => directive.trim().toLowerCase() === "no-store") ||
    !/^application\/json(?:\s*;|$)/iu.test(headers.get("Content-Type") ?? "") ||
    !boundedIdentityText(v.subjectId, 512) ||
    !boundedIdentityText(v.issuer, 2048) ||
    !boundedIdentityText(v.displayName, 1024) ||
    (v.email !== null && !boundedIdentityText(v.email, 320)) ||
    typeof v.emailVerified !== "boolean" ||
    (v.email === null && v.emailVerified) ||
    (v.avatarDataUrl !== null && (typeof v.avatarDataUrl !== "string" || v.avatarDataUrl.length > 250_000)) ||
    typeof v.revision !== "string" ||
    !/^[a-f0-9]{64}$/u.test(v.revision) ||
    (v.updatedAt !== null && (typeof v.updatedAt !== "string" || !Number.isFinite(Date.parse(v.updatedAt)))) ||
    typeof v.serverTimestamp !== "string" ||
    !Number.isFinite(Date.parse(v.serverTimestamp))
  )
    throw new DeletionRequestError(503, "INVALID_REPLY");
  if (v.subjectId !== session.profile.subjectId || v.issuer !== expectedIssuer)
    throw new DeletionRequestError(409, "ACCOUNT_IDENTITY_CHANGED");
  return Object.freeze({
    subjectId: v.subjectId,
    issuer: v.issuer,
    displayName: v.displayName,
    email: v.email,
    emailVerified: v.emailVerified
  });
}
async function assertDisplayedIdentity(session: AuthSession, config: AuthConfig, identity: DeletionIdentity) {
  const current = await readDeletionIdentity(session, config);
  if (!sameDeletionIdentity(identity, current)) throw new DeletionRequestError(409, "ACCOUNT_IDENTITY_CHANGED");
}
export async function prepareDeletion(
  session: AuthSession,
  id: string,
  identity: DeletionIdentity,
  config: AuthConfig
): Promise<BoundDeletionPreflight> {
  await assertDisplayedIdentity(session, config, identity);
  const { status, value } = await request(path + "/preflight", session, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": operation(id) },
    body: "{}"
  });
  if (status !== 200) throw new DeletionRequestError(503, "INVALID_REPLY");
  const plan = parseDeletionPreflight(value, id);
  // A cookie can change while preflight is in flight. Never attach its plan to
  // a previously displayed account without a fresh authenticated readback.
  await assertDisplayedIdentity(session, config, identity);
  return { ...plan, identity };
}
export async function confirmDeletion(
  session: AuthSession,
  plan: BoundDeletionPreflight,
  config: AuthConfig,
  onSubmit?: () => void
) {
  await assertDisplayedIdentity(session, config, plan.identity);
  if (!plan.canConfirm || !plan.planId || !plan.confirmBy || Date.parse(plan.confirmBy) <= Date.now())
    throw new DeletionRequestError(409, "ERASURE_PLAN_EXPIRED_OR_CHANGED");
  // Persist only the operation after all non-destructive checks pass. The
  // backend still binds this plan to the authenticated actor on the POST.
  onSubmit?.();
  const { status, value } = await request(path, session, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": operation(plan.operationId),
      "x-cop-erasure-plan": plan.planId
    },
    body: JSON.stringify({ confirmAccountDeletion: true })
  });
  const receipt = parseDeletionReceipt(value, plan.operationId, status);
  if (status === 200 && !receipt.accountDeleted) throw new DeletionRequestError(503, "INVALID_REPLY");
  return receipt;
}
export async function readDeletionReceipt(id: string) {
  // Only the operation UUID enters the URL. Its capability is HttpOnly and never read by JS.
  const { status, value } = await request(path + "/receipts/" + operation(id));
  return parseDeletionReceipt(value, id, status);
}
