import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresMobilityStore } from "./mobility-store.js";
import { SharedMobilityService } from "./mobility-invitations.js";
const connectionString = process.env.COP_RECORD_DETAILS_TEST_DATABASE_URL;
if (connectionString) { const url = new URL(connectionString); if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/cop_record_details_test") throw Error("Requires isolated loopback cop_record_details_test database"); }
describe.skipIf(!connectionString)("real PostgreSQL shared profile audit recovery", () => {
  it("serializes unique owner binding and retains corrections across fresh connections", async () => {
    const first = new PostgresMobilityStore({ connectionString, max: 3 }), second = new PostgresMobilityStore({ connectionString, max: 3 });
    try {
      await first.init(); await second.init();
      const now = () => new Date("2026-10-05T12:00:00Z"), s = new SharedMobilityService(first, now), t = new SharedMobilityService(second, now);
      const account = await s.account({ authMode: "oidc", issuer: "https://synthetic.test", subjectId: randomUUID(), username: "Synthetic", displayName: "Synthetic" });
      const localVehicleId = randomUUID(), create = () => ({ operationId: randomUUID(), details: { name: "Synthetic", routingProfile: { version: 1 as const, powertrain: "electric" as const, mappedProfile: { version: "sim-mapped-road-profile-v1" as const, coverageAcknowledged: "mapped_restrictions_incomplete" as const, intent: "car" as const } } }, ownerBinding: { version: 1 as const, localVehicleId } });
      const result = await Promise.allSettled([s.createVehicle(account, create()), t.createVehicle(account, create())]);
      expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1); const failure = result.find(r => r.status === "rejected") as PromiseRejectedResult; expect(failure.reason).toMatchObject({ code: "OWNER_BINDING_EXISTS" });
      const vehicle = (await t.listVehicles(account)).items[0]!; expect(vehicle.ownerBinding?.localVehicleId).toBe(localVehicleId); expect(vehicle.details.routingProfile?.powertrain).toBe("electric");
      const base = { operationId: randomUUID(), recordId: randomUUID(), expectedRecordRevision: 0, expectedDataRevision: 1, expectedMembershipRevision: 1, occurredAt: "2026-10-05T01:00:00Z", timeZone: "UTC", data: { kind: "expense" as const, category: "parking" as const, amount: { currency: "CZK" as const, minorUnits: "1000" } } };
      await s.writeRecord(account, vehicle.vehicleId, base);
      const edit = { ...base, operationId: randomUUID(), expectedRecordRevision: 1, expectedDataRevision: 2, data: { ...base.data, amount: { currency: "CZK" as const, minorUnits: "2000" } }, correction: { version: 1 as const, recordId: base.recordId, recordRevision: 1, reason: "Synthetic correction" } };
      const receipt = await t.writeRecord(account, vehicle.vehicleId, edit); expect(receipt.recordRevision).toBe(2); expect(await s.writeRecord(account, vehicle.vehicleId, edit)).toEqual(receipt);
      const third = new PostgresMobilityStore({ connectionString, max: 1 }); try { await third.init(); const restored = new SharedMobilityService(third, now); expect((await restored.getVehicle(account, vehicle.vehicleId)).ownerBinding?.localVehicleId).toBe(localVehicleId); const sync = await restored.syncVehicle(account, vehicle.vehicleId, undefined); expect(sync.items.find(e => e.record?.revision === 1)?.record?.data).toEqual(base.data); expect(sync.items.at(-1)?.audit).toMatchObject({ action: "correct", previousRecordRevision: 1, reason: "Synthetic correction" }); expect(await restored.writeRecord(account, vehicle.vehicleId, edit)).toEqual(receipt); } finally { await third.close(); }
    } finally { await first.close(); await second.close(); }
  });
});
