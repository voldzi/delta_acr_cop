import { acceptsMobilitySchema } from "./mobility-contract.js";
import { validateVehicleProfileRequest } from "./routing-vehicle-profile.js";
import type { VehicleState } from "./mobility-service.js";
import type * as W from "./mobility-types.js";

export function validSharedRoutingProfile(value: W.SharedVehicleRoutingProfile): boolean {
  if (!acceptsMobilitySchema("SharedVehicleRoutingProfile", value)) return false;
  const mapped = value.mappedProfile;
  if (mapped.intent !== "commercial_truck" && (mapped.vehicle?.axleCount !== undefined || mapped.vehicle?.axleLoadKg !== undefined)) return false;
  try {
    validateVehicleProfileRequest({ profileId: "car", from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 0 }, vehicleProfile: value.mappedProfile });
    return true;
  } catch { return false; }
}

/** Current reminders only; never infer completeness from a paged history. */
export function activeCareReminders(state: VehicleState): W.SharedVehicleActiveCareReminders {
  const active = Object.values(state.records).filter(record => !record.deleted && record.data.kind === "reminder" && !record.data.completed);
  const base = { version: 1 as const, dataRevision: state.vehicle.dataRevision };
  if (active.length > 500 || active.some(record => !acceptsMobilitySchema("SharedVehicleRecord", record))) return { ...base, state: "unavailable", items: [] };
  const items: W.SharedVehicleActiveCareItem[] = active.map(record => {
    const data = record.data as Extract<W.SharedVehicleRecordData, { kind: "reminder" }>;
    return { recordId: record.recordId, recordRevision: record.revision, title: data.title,
      ...(data.dueAt !== undefined ? { dueAt: data.dueAt } : {}), ...(data.dueOdometerKm !== undefined ? { dueOdometerKm: data.dueOdometerKm } : {}) };
  }).sort((a, b) => a.recordId.localeCompare(b.recordId, "en"));
  if (items.some(item => !acceptsMobilitySchema("SharedVehicleActiveCareItem", item))) return { ...base, state: "unavailable", items: [] };
  return { ...base, state: "complete", items };
}

export function writeAudit(state: VehicleState, input: W.SharedVehicleRecordWrite): { audit?: W.SharedVehicleRecordAudit; issue?: { status: number; code: string } } {
  const current = state.records[input.recordId];
  const correctionTarget = input.data.kind === "odometer" && input.data.correctionOfRecordId ? state.records[input.data.correctionOfRecordId] : undefined;
  const target = current ?? correctionTarget;
  if (input.correction) {
    const c = input.correction;
    if (!acceptsMobilitySchema("SharedVehicleRecordCorrection", c) || !c.reason.trim()) return { issue: { status: 422, code: "INVALID_RECORD_CORRECTION" } };
    if (!target || target.deleted || c.recordId !== target.recordId || c.recordRevision !== target.revision) return { issue: { status: 409, code: "CORRECTION_BASE_CHANGED" } };
    if (!current && (input.data.kind !== "odometer" || input.data.correctionOfRecordId !== c.recordId || input.data.correctionReason?.trim() !== c.reason.trim())) return { issue: { status: 422, code: "INVALID_RECORD_CORRECTION" } };
  }
  const reason = input.correction?.reason.trim() ?? (input.data.kind === "odometer" ? input.data.correctionReason?.trim() : undefined);
  return { audit: { version: 1, action: target ? "correct" : "create", operationId: input.operationId,
    ...(target ? { previousRecordId: target.recordId, previousRecordRevision: target.revision } : {}), ...(reason ? { reason } : {}) } };
}
