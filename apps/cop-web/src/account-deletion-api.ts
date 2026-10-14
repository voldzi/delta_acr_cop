import type { AuthSession } from "./auth";

const path = "/api/v1/me/account-deletion";
const deletionScope = "cop_jizda_preserve_shared_identity_sim";
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
    v.contractVersion !== "cop-account-erasure-preflight-v1" ||
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
    v.contractVersion !== "cop-account-erasure-v1" ||
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
  const value: unknown = await response.json();
  if (!response.ok) {
    const v = object(value),
      e = object(v.error);
    throw new DeletionRequestError(response.status, typeof e.code === "string" ? e.code : "UNAVAILABLE");
  }
  return { status: response.status, value };
}
export async function deletionAvailable(session: AuthSession): Promise<boolean> {
  const { status, value } = await request(path + "/capabilities", session),
    v = object(value);
  if (status !== 200 || v.contractVersion !== "cop-account-erasure-v1" || typeof v.accountDeletion !== "boolean")
    throw new DeletionRequestError(503, "INVALID_REPLY");
  return v.accountDeletion;
}
export async function prepareDeletion(session: AuthSession, id: string) {
  const { status, value } = await request(path + "/preflight", session, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": operation(id) },
    body: "{}"
  });
  if (status !== 200) throw new DeletionRequestError(503, "INVALID_REPLY");
  return parseDeletionPreflight(value, id);
}
export async function confirmDeletion(session: AuthSession, plan: DeletionPreflight) {
  if (!plan.canConfirm || !plan.planId || !plan.confirmBy || Date.parse(plan.confirmBy) <= Date.now())
    throw new DeletionRequestError(409, "ERASURE_PLAN_EXPIRED_OR_CHANGED");
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
