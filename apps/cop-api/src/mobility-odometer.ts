import type { VehicleState } from "./mobility-service.js";
import type * as W from "./mobility-types.js";

/** Whole-state projection, not a paged-event estimate or additive mileage counter. */
export function sharedOdometerSnapshot(state: VehicleState, now: Date): W.SharedVehicleOdometerSnapshot {
  const base = { version: 1 as const, dataRevision: state.vehicle.dataRevision };
  const review = (reason: W.SharedVehicleOdometerSnapshot["reason"]): W.SharedVehicleOdometerSnapshot => ({ ...base, status: "reviewRequired", reason });
  const active = Object.values(state.records).filter(record => !record.deleted);
  const corrections = new Map<string, string>();
  for (const record of active) {
    if (record.data.kind !== "odometer" || !record.data.correctionOfRecordId) continue;
    const target = state.records[record.data.correctionOfRecordId];
    if (!target || target.vehicleId !== state.vehicle.vehicleId || target.data.kind !== "odometer" || target.recordId === record.recordId) return review("invalid_correction");
    if (!target.deleted) corrections.set(record.recordId, target.recordId);
  }
  const done = new Set<string>();
  for (const start of corrections.keys()) {
    const path = new Set<string>(); let id: string | undefined = start;
    while (id && !done.has(id)) {
      if (path.has(id)) return review("invalid_correction");
      path.add(id); id = corrections.get(id);
    }
    for (const key of path) done.add(key);
  }
  const excluded = new Set(corrections.values());
  const observations: Array<{ record: W.SharedVehicleRecord; value: string; units: bigint; time: number }> = [];
  for (const record of active) {
    if (excluded.has(record.recordId)) continue;
    if (record.vehicleId !== state.vehicle.vehicleId || !Number.isInteger(record.revision) || record.revision < 1) return review("invalid_observation");
    let value: string | undefined;
    if (record.data.kind === "odometer" || record.data.kind === "service") value = record.data.odometerKm;
    else if (record.data.kind === "energy") {
      if (record.data.details?.odometerKm !== undefined && record.data.details.version !== 1) return review("invalid_observation");
      value = record.data.details?.odometerKm;
    }
    if (value === undefined) continue;
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/u.test(value)) return review("invalid_observation");
    const time = Date.parse(record.occurredAt);
    if (!Number.isFinite(time)) return review("invalid_observation");
    if (time > now.getTime() + 300000) return review("future_observation");
    const [whole, fraction = ""] = value.split(".");
    observations.push({ record, value, units: BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, "0")), time });
  }
  observations.sort((a,b) => a.time - b.time || a.record.recordId.localeCompare(b.record.recordId, "en"));
  if (!observations.length) return { ...base, status: "unknown", reason: "no_observations" };
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1]!, current = observations[i]!;
    if (current.time === previous.time && current.units !== previous.units) return review("conflicting_observations");
    if (current.units < previous.units) return review("decreasing_observation");
  }
  const latest = observations.at(-1)!;
  return { ...base, status: "known", valueKm: latest.value, observedAt: latest.record.occurredAt,
    source: { recordId: latest.record.recordId, recordRevision: latest.record.revision,
      recordKind: latest.record.data.kind as W.SharedVehicleOdometerSource["recordKind"] } };
}
