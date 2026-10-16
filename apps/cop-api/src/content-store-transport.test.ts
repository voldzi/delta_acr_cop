import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createCommunityReportStoreFromEnv } from "./community-report-store.js";
import { createIncidentStoreFromEnv } from "./incident-store.js";
import { createSketchDrawingStoreFromEnv } from "./sketch-store.js";

const factories = [createCommunityReportStoreFromEnv, createIncidentStoreFromEnv, createSketchDrawingStoreFromEnv];
afterEach(() => vi.unstubAllEnvs());

describe("content stores share the explicit database transport", () => {
  it("keeps disabled TLS explicit even when the process requests TLS, so admission does not borrow a differently configured connection", async () => {
    vi.stubEnv("PGSSLMODE", "require");
    const stores = factories.map(factory => factory({ COP_DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic", COP_DATABASE_SSL: "false" })!);
    try {
      for (const store of stores) expect((store as unknown as { pool: Pool }).pool.options.ssl).toBe(false);
    } finally { await Promise.all(stores.map(store => store.close())); }
  });
  it("preserves certificate verification when TLS is enabled", async () => {
    const stores = factories.map(factory => factory({ COP_DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic", COP_DATABASE_SSL: "true" })!);
    try {
      for (const store of stores) expect((store as unknown as { pool: Pool }).pool.options.ssl).toEqual({ rejectUnauthorized: true });
    } finally { await Promise.all(stores.map(store => store.close())); }
  });
});
