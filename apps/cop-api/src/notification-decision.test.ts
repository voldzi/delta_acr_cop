import { describe, expect, it } from "vitest";
import {
  buildCommunityReportNotificationDecision,
  buildSafetyFeatureNotificationDecision,
  evaluateSafetyFeatureCandidate
} from "./notification-decision.js";
import type { CommunityReportRecord } from "./community-report-store.js";
import type { SafetyFeature } from "./safety-data-source.js";

describe("notification decision", () => {
  const requestNow = new Date("2026-05-29T12:00:00Z");

  it("builds a citizen-safe safety notification only for relevant warning features", () => {
    const feature = safetyFeature({
      featureId: "chmi-warning-1",
      headline: "Silny vitr",
      severity: "warning",
      validFrom: "2026-05-29T11:00:00Z",
      validUntil: "2026-05-29T18:00:00Z"
    });

    const decision = buildSafetyFeatureNotificationDecision(feature, {
      audience: { groupIds: ["group-prague"] },
      now: requestNow
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.idempotencyKey).toBe("sim.safety-data:public.safety.weather_alerts:chmi-warning-1:2026-05-29T11:00:00Z:2026-05-29T18:00:00Z");
    expect(decision.notification).toMatchObject({
      audience: { groupIds: ["group-prague"] },
      deepLink: "csm://map/alert/chmi-warning-1",
      source: {
        featureId: "chmi-warning-1",
        layerId: "public.safety.weather_alerts",
        providerId: "sim.safety-data"
      },
      type: "safety.alert"
    });
  });

  it("does not turn stale or reference safety data into citizen push alerts", () => {
    expect(evaluateSafetyFeatureCandidate(safetyFeature({ stale: true }), requestNow)).toMatchObject({
      ok: false,
      reason: "Safety feature is stale."
    });
    expect(evaluateSafetyFeatureCandidate(safetyFeature({ layer: "boundary_admin", layerId: "public.boundary.admin" }), requestNow)).toMatchObject({
      ok: false,
      reason: "Boundary reference layers are not citizen safety alerts."
    });
    expect(evaluateSafetyFeatureCandidate(safetyFeature({ severity: "info" }), requestNow)).toMatchObject({
      ok: false,
      reason: "Safety feature severity is below push threshold."
    });
    expect(evaluateSafetyFeatureCandidate(safetyFeature({
      providerProperties: {
        notification: {
          eligible: false
        }
      }
    }), requestNow)).toMatchObject({
      ok: false,
      reason: "Safety feature is not eligible for notification by provider policy."
    });
  });

  it("uses SIM canonical safety taxonomy and localized text in push payloads", () => {
    const decision = buildSafetyFeatureNotificationDecision(safetyFeature({
      category: "legacy.category",
      hazardType: "legacy_hazard_text",
      headline: "Fallback headline",
      localized: {
        cs: {
          headline: "Vysoké teploty v okolí",
          recommendation: "Omezte fyzickou zátěž a doplňujte tekutiny."
        },
        en: {
          headline: "High temperatures nearby"
        }
      },
      providerProperties: {
        presentation: {
          iconKey: "weather.temperature.high",
          styleKey: "heat-warning"
        },
        taxonomy: {
          sourceCode: "I.2",
          sourceSystem: "CHMI_SIVS",
          typeCode: "weather.temperature.high"
        }
      },
      sourceCode: undefined,
      sourceSystem: undefined,
      typeCode: undefined
    }), {
      audience: { userIds: ["user-1"] },
      now: requestNow
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.notification.title).toEqual({
      cs: "Výstraha: Vysoké teploty v okolí",
      en: "Alert: High temperatures nearby"
    });
    expect(decision.notification.body.cs).toBe("Omezte fyzickou zátěž a doplňujte tekutiny.");
    expect(decision.notification.metadata).toMatchObject({
      iconKey: "weather.temperature.high",
      sourceCode: "I.2",
      sourceSystem: "CHMI_SIVS",
      styleKey: "heat-warning",
      typeCode: "weather.temperature.high"
    });
    expect(decision.notification.metadata).not.toHaveProperty("hazardType");
  });

  it("keeps general SIM warnings separate from weather alerts", () => {
    const decision = buildSafetyFeatureNotificationDecision(safetyFeature({
      featureId: "gdacs-warning-1",
      layer: "warnings",
      layerId: undefined,
      sourceId: "gdacs_alerts",
      sourceName: "GDACS",
      typeCode: "crisis.earthquake"
    }), {
      audience: { userIds: ["user-1"] },
      now: requestNow
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.idempotencyKey).toBe("sim.safety-data:public.safety.warnings:gdacs-warning-1:2026-05-29T11:00:00Z:2026-05-29T18:00:00Z");
    expect(decision.notification.source.layerId).toBe("public.safety.warnings");
  });

  it("maps CHMI hydro floodStage to notification severity without promoting trend alone", () => {
    const warningDecision = buildSafetyFeatureNotificationDecision(safetyFeature({
      featureId: "hydro-2spa",
      floodStage: 2,
      layer: "flood",
      layerId: "public.safety.flood",
      severity: undefined,
      sourceId: "chmi_hydro",
      trend: "stable"
    }), {
      audience: { groupIds: ["group-river"] },
      now: requestNow
    });
    expect(warningDecision.shouldSend).toBe(true);
    expect(warningDecision.notification.severity).toBe("warning");
    expect(warningDecision.notification.priority).toBe("time_sensitive");

    const criticalDecision = buildSafetyFeatureNotificationDecision(safetyFeature({
      featureId: "hydro-3spa",
      floodStage: 3,
      layer: "flood",
      layerId: "public.safety.flood",
      severity: undefined,
      sourceId: "chmi_hydro"
    }), {
      audience: { groupIds: ["group-river"] },
      now: requestNow
    });
    expect(criticalDecision.shouldSend).toBe(true);
    expect(criticalDecision.notification.severity).toBe("critical");

    expect(evaluateSafetyFeatureCandidate(safetyFeature({
      floodStage: 0,
      layer: "flood",
      layerId: "public.safety.flood",
      severity: undefined,
      sourceId: "chmi_hydro",
      trend: "rising"
    }), requestNow)).toMatchObject({
      ok: false,
      reason: "Safety feature severity is below push threshold."
    });
  });

  it("matches safety features to a user's watched area before dispatch", () => {
    const decision = buildSafetyFeatureNotificationDecision(safetyFeature({}), {
      actor: { subjectId: "user-1" },
      now: requestNow,
      watchedAreas: [
        {
          enabled: true,
          id: "aoi-prague",
          lat: 50.08,
          lon: 14.42,
          name: "Praha",
          radiusKm: 20
        }
      ]
    });

    expect(decision.shouldSend).toBe(true);
    expect(decision.notification.audience).toEqual({
      areaIds: ["aoi-prague"],
      userIds: ["user-1"]
    });
    expect(decision.relevance.source).toBe("watched-area");
  });

  it("builds group-scoped community report notifications without media payloads", () => {
    const report = communityReport({
      groupId: "group-vrbno",
      hazardSeverity: "critical",
      status: "submitted",
      validUntil: "2026-05-29T18:00:00Z"
    });

    const decision = buildCommunityReportNotificationDecision(report, requestNow);

    expect(decision.shouldSend).toBe(true);
    expect(decision.notification).toMatchObject({
      audience: { groupIds: ["group-vrbno"] },
      deepLink: `csm://map/report/${report.reportId}`,
      source: {
        layerId: "public.community.reports",
        providerId: "cop.community"
      },
      type: "community.report"
    });
    expect(JSON.stringify(decision.notification)).not.toContain("photo");
    expect(JSON.stringify(decision.notification)).not.toContain("video");
  });

  it("skips community reports without a concrete audience", () => {
    const decision = buildCommunityReportNotificationDecision(communityReport({
      groupId: undefined,
      status: "submitted"
    }), requestNow);

    expect(decision.shouldSend).toBe(false);
    expect(decision.reason).toBe("Community report has no group, user or area audience.");
  });
});

function safetyFeature(properties: Partial<SafetyFeature["properties"]>): SafetyFeature {
  return {
    geometry: {
      coordinates: [14.42, 50.08],
      type: "Point"
    },
    properties: {
      category: "warning.wind",
      featureId: "warning-1",
      headline: "Vystraha",
      layer: "weather_alerts",
      layerId: "public.safety.weather_alerts",
      severity: "warning",
      sourceId: "chmi_alerts",
      sourceName: "CHMI CAP",
      validFrom: "2026-05-29T11:00:00Z",
      validUntil: "2026-05-29T18:00:00Z",
      ...properties
    },
    type: "Feature"
  };
}

function communityReport(options: {
  groupId?: string;
  hazardSeverity?: string;
  status?: CommunityReportRecord["status"];
  validUntil?: string;
}): CommunityReportRecord {
  return {
    attachments: [],
    category: "flood",
    createdAt: "2026-05-29T11:00:00Z",
    createdBy: {
      displayName: "User",
      subjectId: "user-1",
      username: "user-1"
    },
    location: {
      lat: 50.08,
      lon: 14.42,
      source: "manual"
    },
    observedAt: "2026-05-29T11:00:00Z",
    properties: {
      ...(options.groupId ? { groupId: options.groupId } : {}),
      hazardSeverity: options.hazardSeverity ?? "warning",
      ...(options.validUntil ? { validUntil: options.validUntil } : {})
    },
    reportId: "report-1",
    status: options.status ?? "draft",
    submittedAt: options.status === "submitted" ? "2026-05-29T11:05:00Z" : undefined,
    title: "Zaplaveny most",
    updatedAt: "2026-05-29T11:05:00Z",
    visibility: "community"
  };
}
