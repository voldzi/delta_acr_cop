import type { AccountErasureOwnerReadiness } from "./account-erasure.js";

type Owner = { ownerReadiness(): Promise<AccountErasureOwnerReadiness> };
export interface AccountErasureReadinessHealth {
  name: "cop-account-erasure-owners";
  status: "ok" | "disabled" | "unavailable";
  checkedAt?: string;
  detail: string;
}
/** Public aggregate health only. No accounts, credentials, owner manifests or
 * deletion permission. Share probes so public health polling cannot fan out
 * eleven provider checks on every request. Intake still has its fresh checks. */
export function createAccountErasureReadinessHealth(service: () => Owner | undefined, now = Date.now) {
  let cached: { owner: Owner; until: number; value: AccountErasureReadinessHealth } | undefined;
  let pending: { owner: Owner; result: Promise<AccountErasureReadinessHealth> } | undefined;
  return async (): Promise<AccountErasureReadinessHealth> => {
    const owner = service();
    if (!owner) return { name: "cop-account-erasure-owners", status: "disabled", detail: "Account erasure guard is not configured." };
    if (cached?.owner === owner && cached.until > now()) return { ...cached.value };
    if (pending?.owner === owner) return pending.result;
    const result = (async (): Promise<AccountErasureReadinessHealth> => {
      let value: AccountErasureReadinessHealth;
      try {
        const actual = await owner.ownerReadiness(), checked = Date.parse(actual.checkedAt);
        const valid = actual.contractVersion === "cop-account-erasure-owner-readiness-v1" &&
          typeof actual.ready === "boolean" && (actual.ready ? !("unavailableReason" in actual) : ["required_adapters_missing", "adapter_unavailable"].includes(actual.unavailableReason ?? "")) && Number.isFinite(checked) && checked <= now() && now() - checked <= 30_000 &&
          Object.keys(actual).every(key => ["contractVersion", "ready", "checkedAt", "unavailableReason"].includes(key));
        value = valid ? { name: "cop-account-erasure-owners", status: actual.ready ? "ok" : "unavailable", checkedAt: actual.checkedAt,
          detail: "Read-only owner checks; deletion intake is controlled separately." }
          : { name: "cop-account-erasure-owners", status: "unavailable", detail: "Owner readiness could not be verified." };
      } catch {
        value = { name: "cop-account-erasure-owners", status: "unavailable", detail: "Owner readiness could not be verified." };
      }
      cached = { owner, until: now() + 30_000, value };
      return { ...value };
    })();
    pending = { owner, result };
    try { return await result; } finally { if (pending?.result === result) pending = undefined; }
  };
}
