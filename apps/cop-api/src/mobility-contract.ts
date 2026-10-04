import { readFileSync } from "node:fs";

type Schema = {
  $ref?: string;
  oneOf?: Schema[];
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  enum?: unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
};
const contract = JSON.parse(
  readFileSync(new URL("../../../docs/api/shared-mobility-v1.openapi.json", import.meta.url), "utf8")
) as {
  components: { schemas: Record<string, Schema> };
  paths: Record<
    string,
    Record<string, { operationId: string; requestBody?: { content: { "application/json": { schema: Schema } } } }>
  >;
};
export const mobilityContract = contract;
export function acceptsMobilitySchema(name: string, value: unknown): boolean {
  return check(contract.components.schemas[name]!, value, 0);
}
function check(schema: Schema, value: unknown, depth: number): boolean {
  if (!schema || depth > 20) return false;
  if (schema.$ref) return check(contract.components.schemas[schema.$ref.split("/").at(-1)!]!, value, depth + 1);
  if (schema.oneOf) return schema.oneOf.filter((part) => check(part, value, depth + 1)).length === 1;
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (schema.required?.some((key) => !Object.hasOwn(object, key))) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(object).some((key) => !Object.hasOwn(schema.properties ?? {}, key))
    )
      return false;
    return Object.entries(object).every(([key, item]) =>
      schema.properties?.[key] ? check(schema.properties[key], item, depth + 1) : schema.additionalProperties !== false
    );
  }
  if (schema.type === "array")
    return (
      Array.isArray(value) &&
      value.length <= (schema.maxItems ?? Infinity) &&
      value.length >= (schema.minItems ?? 0) &&
      (!schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length) &&
      value.length >= (schema.minItems ?? 0) &&
      (!schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length) &&
      value.every((item) => check(schema.items!, item, depth + 1))
    );
  if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? Infinity)
    )
      return false;
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return false;
    if (
      schema.format === "uuid" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    )
      return false;
    if (
      schema.format === "date-time" &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,19) !== value.slice(0,19))
    )
      return false;
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return false;
    return true;
  }
  if (schema.type === "integer" || schema.type === "number")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (schema.type !== "integer" || Number.isSafeInteger(value)) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  return schema.type === "boolean" && typeof value === "boolean";
}

export function normalizeMobilityInput(name: string, value: unknown): unknown {
  function normalize(schema: Schema, item: unknown): unknown {
    if (schema.$ref) return normalize(contract.components.schemas[schema.$ref.split("/").at(-1)!]!, item);
    if (schema.oneOf) return normalize(schema.oneOf.find(part => check(part, item, 0))!, item);
    if (schema.type === "string" && schema.format === "uuid") return (item as string).toLowerCase();
    if (schema.type === "array") return (item as unknown[]).map(child => normalize(schema.items!, child));
    if (schema.type === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [key, normalize(schema.properties![key]!, child)]));
    return item;
  }
  return normalize(contract.components.schemas[name]!, value);
}
