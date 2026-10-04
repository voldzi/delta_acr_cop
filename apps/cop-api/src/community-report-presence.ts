import type { CommunityReportRecord, CommunityReportConfirmationSummary } from "./community-report-store.js";

const transient = new Set([
  "police_patrol",
  "traffic_congestion",
  "traffic_accident",
  "stopped_vehicle",
  "road_blockage",
  "dangerous_weather",
  "hazard"
]);
/** Read-time decision, preserving records and unique votes; never a routing instruction. */
export function communityReportPresence(
  report: CommunityReportRecord,
  now: Date,
  votes?: CommunityReportConfirmationSummary
): {
  policyVersion: "cop-report-presence-v1";
  active: boolean;
  reason: "active" | "expired" | "lifecycle" | "independent_absence";
} {
  const expires = typeof report.properties.validUntil === "string" ? Date.parse(report.properties.validUntil) : NaN;
  const negative = votes?.independentNotThereCount ?? 0;
  const positive = votes?.independentStillThereCount ?? 0;
  const reason = !["submitted", "published"].includes(report.status)
    ? "lifecycle"
    : Number.isFinite(expires) && expires <= now.getTime()
      ? "expired"
      : transient.has(report.category) && negative >= 3 && negative - positive >= 2
        ? "independent_absence"
        : "active";
  return { policyVersion: "cop-report-presence-v1", active: reason === "active", reason };
}
