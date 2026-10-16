import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { legacyErasureColumnsSql, legacyErasureTablesSql } from "./legacy-erasure-schema.js";
const normalize = (s: string) => s.replace(/\s+/gu, " ").replace(/\s*([(),=])\s*/gu, "$1").trim();
const actual = ["user-profile-store.ts", "mobile-device-store.ts", "voice-call-store.ts", "web-session-store.ts"].map(name => normalize(readFileSync(new URL(name, import.meta.url), "utf8")));
describe("narrow legacy preparation matches actual source DDL", () => {
 it("contains precisely eight approved ADD clauses and three tables plus the existing partial index", () => {
  const columns = legacyErasureColumnsSql.split(";").map(v => v.trim()).filter(Boolean), tables = legacyErasureTablesSql.split(";").map(v => v.trim()).filter(Boolean);
  expect(columns).toHaveLength(8); expect(tables).toHaveLength(4);
  for (const statement of [...columns, ...tables]) expect(actual.some(s => s.includes(normalize(statement)))).toBe(true);
  expect(columns.every(s => /^ALTER TABLE cop_[a-z_]+ ADD COLUMN IF NOT EXISTS [a-z_]+ (?:text|boolean NOT NULL DEFAULT false)$/u.test(s))).toBe(true);
  expect(tables.filter(s => s.startsWith("CREATE TABLE")).map(s => /^CREATE TABLE IF NOT EXISTS (\w+)/u.exec(s)![1]).sort()).toEqual(["cop_user_profile_erasure_fences", "cop_web_session_erasure_fences", "cop_web_session_erasure_metadata"]);
  expect([...columns, ...tables].some(s => /\b(?:UPDATE|DELETE|INSERT|GRANT|DROP|RENAME)\b/u.test(s))).toBe(false);
 });
});
