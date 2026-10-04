import { describe, expect, it } from "vitest";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import { communityReportPresence } from "./community-report-presence.js";
import { buildServer } from "./server.js";

describe("server-owned community presence", () => {
  it("accepts police unchanged, preserves offline time/idempotency, suppresses independent absence and recovers after correction", async () => {
    let now = new Date("2026-10-04T10:00:00Z");
    const store = new InMemoryCommunityReportStore();
    const app = buildServer({ communityReportStore: store, now: () => now });
    const headers = {
      authorization: "Bearer dev-lab-token",
      "x-idempotency-key": "e54146fd-cfc0-4568-bb47-c83c0d3f6221"
    };
    try {
      const body = {
        category: "police_patrol",
        location: { lat: 50, lon: 14, source: "device", accuracyM: 10 },
        observedAt: "2026-10-04T09:55:00Z",
        visibility: "community"
      };
      const created = await app.inject({ method: "POST", url: "/api/v1/community/reports", headers, payload: body });
      expect(created.statusCode).toBe(201);
      const id = created.json().reportId;
      expect(created.json()).toMatchObject({
        category: "police_patrol",
        properties: { validUntil: "2026-10-04T10:25:00.000Z" }
      });
      expect(
        (await app.inject({ method: "POST", url: "/api/v1/community/reports", headers, payload: body })).json().reportId
      ).toBe(id);
      expect(
        (await app.inject({ method: "POST", url: `/api/v1/community/reports/${id}/submit`, headers })).statusCode
      ).toBe(200);
      const feed = async (extra = "") =>
        (await app.inject({ url: "/api/v1/community/reports?categories=police_patrol" + extra, headers })).json();
      expect((await feed()).featureCollection.features[0].properties.category).toBe("police_patrol");
      now = new Date("2026-10-04T10:01:00Z");
      for (let n = 0; n < 10; n++) await store.upsertReportConfirmation(id, "lab", "not_there", now);
      await store.upsertReportConfirmation(id, "one", "not_there", now);
      await store.upsertReportConfirmation(id, "two", "not_there", now);
      expect((await feed()).items).toHaveLength(1);
      await store.upsertReportConfirmation(id, "three", "not_there", now);
      expect((await feed()).items).toHaveLength(0);
      expect((await feed()).featureCollection.features).toHaveLength(0);
      expect((await feed("&includeExpired=true")).items[0].presence).toMatchObject({
        active: false,
        reason: "independent_absence"
      });
      now = new Date("2026-10-04T10:02:00Z");
      await store.updateReport(id, "lab", { title: "Opravené pozorování", changeReason: "Oprava" }, now);
      expect((await feed()).items).toHaveLength(1);
      now = new Date("2026-10-04T10:25:00Z");
      expect((await feed()).items).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
  it("does not use negative votes to remove a fire or create any routing closure", async () => {
    const store = new InMemoryCommunityReportStore();
    const now = new Date();
    const report = await store.createReport(
      {
        category: "fire",
        createdBy: { subjectId: "a", username: "a", displayName: "a" },
        title: "synthetic",
        observedAt: now.toISOString(),
        location: { lat: 50, lon: 14, source: "device" },
        visibility: "community"
      },
      now
    );
    report.status = "submitted";
    expect(
      communityReportPresence(report, now, {
        independentNotThereCount: 20,
        notThereCount: 20,
        stillThereCount: 0,
        totalCount: 20
      }).active
    ).toBe(true);
  });
  it("returns 503 and never acknowledges ephemeral fallback on durable storage failure", async () => {
    const store = new InMemoryCommunityReportStore();
    store.createReport = async () => {
      throw Error("synthetic outage");
    };
    const app = buildServer({ communityReportStore: store });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/community/reports",
        headers: { authorization: "Bearer dev-lab-token" },
        payload: { category: "police_patrol", location: { lat: 50, lon: 14, source: "device" } }
      });
      expect(r.statusCode).toBe(503);
      expect(r.json().error.code).toBe("COMMUNITY_REPORT_STORE_UNAVAILABLE");
    } finally {
      await app.close();
    }
  });
});
