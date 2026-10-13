import type { DriverConsent } from "./driver-measurement-contract.js";
import type { SimDriverReceipt } from "./driver-measurement-source.js";

export interface DriverMeasurementUserStatus {
  code: "consent_required" | "consent_active" | "regrant_wait"
    | "intake_unavailable" | "deletion_pending" | "deletion_complete"
    | "accepted" | "partially_accepted" | "already_received" | "no_usable_measurements";
  message: string;
}

const messages: Record<DriverMeasurementUserStatus["code"], string> = {
  consent_required: "Dobrovolné měření dopravy vyžaduje váš samostatný souhlas.",
  consent_active: "Souhlas s dobrovolným měřením dopravy je udělen.",
  regrant_wait: "Souhlas je odvolán a smazání je dokončeno. Nový souhlas je možný nejdříve v dalším UTC dni.",
  intake_unavailable: "Příjem měření pro tento účet je nyní pozastaven. Dřívější souhlas můžete stále odvolat.",
  deletion_pending: "Souhlas je odvolán. Smazání dřívějších dopravních příspěvků čeká na dokončení.",
  deletion_complete: "Souhlas je odvolán. Smazání dopravních příspěvků je dokončeno.",
  accepted: "Měření jsou přijata pro stínové vyhodnocení kvality dopravy.",
  partially_accepted: "Nový příspěvek je přijat pro stínové vyhodnocení. Dávka obsahuje i odmítnuté položky.",
  already_received: "Opakované úseky již byly zpracovány; nevznikl nový příspěvek.",
  no_usable_measurements: "Dávka byla zpracována, ale neobsahuje použitelná nová měření."
};

function status(code: DriverMeasurementUserStatus["code"]): DriverMeasurementUserStatus {
  return { code, message: messages[code] };
}

export function consentUserStatus(consent: DriverConsent, intakeAllowed: boolean, now: Date): DriverMeasurementUserStatus {
  // Deletion state takes precedence even when intake is disabled or the account
  // is no longer eligible. A transport success must not imply completed deletion.
  if (consent.pendingDays.length) return status("deletion_pending");
  if (!intakeAllowed) return status("intake_unavailable");
  if (consent.grantedAt && !consent.revokedAt) return status("consent_active");
  if (consent.lastRevokedDay === now.toISOString().slice(0, 10)) return status("regrant_wait");
  return status(consent.revokedAt ? "deletion_complete" : "consent_required");
}

export function revocationUserStatus(pendingDeletion: boolean): DriverMeasurementUserStatus {
  return status(pendingDeletion ? "deletion_pending" : "deletion_complete");
}

export function batchUserStatus(receipt: SimDriverReceipt): DriverMeasurementUserStatus {
  const rejected = Object.values(receipt.rejectionCounts).some((count) => count > 0);
  if (receipt.acceptedIntervalCount > 0 || receipt.etaAccepted) {
    return status(rejected ? "partially_accepted" : "accepted");
  }
  if (receipt.deduplicatedIntervalCount > 0 && !rejected) return status("already_received");
  return status("no_usable_measurements");
}
