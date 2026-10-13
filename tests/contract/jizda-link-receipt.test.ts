import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAjv } from "../../packages/ingest-contracts/src/index.js";

const openapi = JSON.parse(readFileSync(new URL("../../openapi/openapi.json", import.meta.url), "utf8"));
const components = {
  schemas: {
    JizdaLinkReceipt: openapi.components.schemas.JizdaLinkReceipt,
    JizdaLinkStatus: openapi.components.schemas.JizdaLinkStatus
  }
};
const compile = (schema: Record<string, unknown>) => createAjv().compile({ ...schema, components });
const responseSchema = (code: "200" | "202") =>
  openapi.paths["/api/v1/me/app-links/jizda/disconnect"].post.responses[code].content["application/json"].schema;
const pending = {
  contractVersion: "cop-jizda-link-v1",
  app: "jizda",
  scope: "jizda_app_link",
  operationId: "e6450609-cbe5-4c9c-adfa-598db1d125ef",
  requestedAt: "2026-10-11T00:00:00.000Z",
  status: "disconnecting",
  accountDeleted: false,
  localDataDeleted: false,
  remaining: ["matrix_devices", "live_permissions"]
};
const completed = { ...pending, status: "disconnected", remaining: [] };

describe("Jizda unlink receipt contract", () => {
  it("rejects completion while any cleanup remains and pending without a remaining owner", () => {
    const validate = compile({ $ref: "#/components/schemas/JizdaLinkReceipt" });
    expect(validate(pending)).toBe(true);
    expect(validate(completed)).toBe(true);
    expect(validate({ ...pending, status: "disconnected" })).toBe(false);
    expect(validate({ ...completed, status: "disconnecting" })).toBe(false);
  });

  it("permits HTTP 200 only for completed unlink", () => {
    const validate = compile(responseSchema("200"));
    expect(validate(completed)).toBe(true);
    expect(validate(pending)).toBe(false);
  });

  it("permits HTTP 202 only for pending unlink", () => {
    const validate = compile(responseSchema("202"));
    expect(validate(pending)).toBe(true);
    expect(validate(completed)).toBe(false);
  });

  it("keeps GET status compatible with linked, pending and completed states", () => {
    const schema = openapi.paths["/api/v1/me/app-links/jizda"].get.responses["200"].content["application/json"].schema;
    const validate = compile(schema);
    const linked = {
      contractVersion: "cop-jizda-link-v1", app: "jizda", scope: "jizda_app_link",
      status: "linked", accountDeleted: false, localDataDeleted: false
    };
    for (const receipt of [linked, pending, completed]) expect(validate(receipt)).toBe(true);
    expect(validate({ ...linked, remaining: [] })).toBe(false);
  });

  it("rejects claims of account erasure, unknown cleanup owners and duplicate owners", () => {
    const validate = compile({ $ref: "#/components/schemas/JizdaLinkReceipt" });
    for (const receipt of [
      { ...completed, accountDeleted: true },
      { ...completed, localDataDeleted: true },
      { ...pending, remaining: ["unknown"] },
      { ...pending, remaining: ["matrix_devices", "matrix_devices"] }
    ]) expect(validate(receipt)).toBe(false);
  });
});
