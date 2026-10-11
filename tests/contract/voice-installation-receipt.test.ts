import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAjv } from "../../packages/ingest-contracts/src/index.js";

const openapi = JSON.parse(readFileSync(new URL("../../openapi/openapi.json", import.meta.url), "utf8"));
const names = ["VoiceInstallationRevokeRequest", "VoiceInstallationRevocationReceipt", "VoiceGrantProviderRevokeRequest", "VoiceGrantProviderRevokeReceipt"];
const components = { schemas: Object.fromEntries(names.map(name => [name, openapi.components.schemas[name]])) };
const compile = (schema: Record<string, unknown>) => createAjv().compile({ ...schema, components });
const path = openapi.paths["/api/v1/me/voice-installations/revoke"].post;
const pending = { contractVersion: "cop-voice-installation-revocation-v1", operationId: "eb21c8e9-d443-4fa7-aad7-fcc75c5f3289",
  scope: "installation", status: "revoking", joinDenied: true, providerVerified: false, accountDeleted: false };
const completed = { ...pending, status: "revoked", providerVerified: true };

describe("voice installation revocation contract", () => {
  it("allows200 only for provider proof and202 only for pending verification", () => {
    const response = (code: string) => compile(path.responses[code].content["application/json"].schema);
    expect(response("200")(completed)).toBe(true); expect(response("200")(pending)).toBe(false);
    expect(response("202")(pending)).toBe(true); expect(response("202")(completed)).toBe(false);
  });
  it("rejects inconsistent proof, deletion claims and unknown receipt fields", () => {
    const valid = compile({ $ref: "#/components/schemas/VoiceInstallationRevocationReceipt" });
    for (const receipt of [{ ...completed, providerVerified: false }, { ...pending, providerVerified: true },
      { ...completed, accountDeleted: true }, { ...completed, userId: "client-selected" }, { ...pending, joinDenied: false }]) {
      expect(valid(receipt)).toBe(false);
    }
  });
  it("does not accept client-selected account, app or grant identity", () => {
    const valid = compile({ $ref: "#/components/schemas/VoiceInstallationRevokeRequest" });
    const input = { installationId: "5ece5dcb-a8f1-4a4d-8837-d17144b54599" };
    expect(valid(input)).toBe(true);
    for (const added of [{ subjectId: "other" }, { app: "cop" }, { identity: "legacy-subject" }, { grants: [] }]) {
      expect(valid({ ...input, ...added })).toBe(false);
    }
  });
  it("keeps the strict service receipt and reserves opaque scoped participant identities", () => {
    const valid = compile({ $ref: "#/components/schemas/VoiceGrantProviderRevokeReceipt" });
    const receipt = { contractVersion: "cop-voice-grant-revocation-v1", operationId: pending.operationId, providerVerified: false };
    expect(valid(receipt)).toBe(true); expect(valid({ ...receipt, rawToken: "never" })).toBe(false);
    const request = compile({ $ref: "#/components/schemas/VoiceGrantProviderRevokeRequest" });
    expect(request({ operationId: pending.operationId, grants: [{ identity: "legacy-subject", room: "cop-call-" + pending.operationId }] })).toBe(false);
  });
});
