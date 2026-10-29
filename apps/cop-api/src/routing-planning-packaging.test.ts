import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("planning release resources and public contract", () => {
  it("includes the runtime schema in both image stages", () => {
    const docker = readFileSync(new URL("../../../Dockerfile.api", import.meta.url), "utf8");
    expect(docker).toMatch(/^COPY docs docs$/mu);
    expect(docker).toMatch(/^COPY --from=build \/app \.\/$/mu);
    const schemas = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/planning-origin-v1.schemas.json", import.meta.url), "utf8"));
    expect(schemas.components.schemas.PreviewAssessment.required).toContain("knownClosuresEvidence");
  });
  it("keeps runtime/public schemas identical without exposing SIM service authentication as browser input", () => {
    const runtime = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/planning-origin-v1.schemas.json", import.meta.url), "utf8"));
    const api = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
    const prefix = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(prefix);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
        key === "$ref" && typeof entry === "string" && entry.startsWith("#/components/schemas/")
          ? `#/components/schemas/RoutingPlanning${entry.split("/").at(-1)}` : prefix(entry)]));
      return value;
    };
    for (const [name, schema] of Object.entries(runtime.components.schemas)) {
      if (name !== "Problem") expect(api.components.schemas[`RoutingPlanning${name}`]).toEqual(prefix(schema));
    }
    for (const operation of ["candidates", "preview"]) {
      const op = api.paths[`/api/v1/routing/planning-origin/${operation}`].post;
      expect(op.security).toBeUndefined(); expect(api.security).toEqual([{ bearerAuth: [] }]);
      expect(JSON.stringify(op.parameters)).not.toContain("X-COP-Planning-Actor");
      expect(op.responses["503"]).toBeDefined(); expect(op.responses["413"]).toBeDefined();
    }
  });
});
