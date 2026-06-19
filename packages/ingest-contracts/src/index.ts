import type { ErrorObject, ValidateFunction } from "ajv";
import * as Ajv2020Module from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalEventEnvelope, SourceSystem } from "@cop/canonical-model";

export interface ContractValidationResult<T> {
  valid: boolean;
  data?: T;
  errors?: ErrorObject[];
}

export type ContractSchemaName =
  | "canonical-entity.schema.json"
  | "canonical-event-envelope.schema.json"
  | "observed-object.schema.json"
  | "source-system.schema.json"
  | "cop-subscription.schema.json"
  | "symbol-resolve-request.schema.json"
  | "symbol-resolve-response.schema.json"
  | "ai-cop-query.schema.json";

const schemaNames: ContractSchemaName[] = [
  "canonical-entity.schema.json",
  "observed-object.schema.json",
  "canonical-event-envelope.schema.json",
  "source-system.schema.json",
  "cop-subscription.schema.json",
  "symbol-resolve-request.schema.json",
  "symbol-resolve-response.schema.json",
  "ai-cop-query.schema.json"
];

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "docs", "api", "schemas"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return process.cwd();
}

export function getSchemaDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = findWorkspaceRoot(here);
  return join(root, "docs", "api", "schemas");
}

export function loadSchema(name: ContractSchemaName): Record<string, unknown> {
  const raw = readFileSync(join(getSchemaDirectory(), name), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export function loadAllSchemas(): Record<string, unknown>[] {
  return schemaNames.map(loadSchema);
}

interface AjvLike {
  addSchema(schema: Record<string, unknown>): unknown;
  getSchema(schemaKeyRef: string): ValidateFunction | undefined;
  compile(schema: Record<string, unknown>): ValidateFunction;
}

type AjvConstructor = new (options: Record<string, unknown>) => AjvLike;

const Ajv2020 = ((Ajv2020Module as unknown as { default?: AjvConstructor }).default ?? Ajv2020Module) as AjvConstructor;
const addFormats = ((addFormatsModule as unknown as { default?: (ajv: AjvLike) => void }).default ??
  addFormatsModule) as (ajv: AjvLike) => void;

export function createAjv(): AjvLike {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });
  addFormats(ajv);
  for (const schema of loadAllSchemas()) {
    ajv.addSchema(schema);
  }
  return ajv;
}

export class ContractValidators {
  private readonly ajv: AjvLike;
  private readonly validators = new Map<ContractSchemaName, ValidateFunction>();

  constructor(ajv = createAjv()) {
    this.ajv = ajv;
  }

  validateCanonicalEvent(data: unknown): ContractValidationResult<CanonicalEventEnvelope> {
    return this.validate("canonical-event-envelope.schema.json", data);
  }

  validateCanonicalEntity<T = unknown>(data: unknown): ContractValidationResult<T> {
    return this.validate("canonical-entity.schema.json", data);
  }

  validateSourceSystem(data: unknown): ContractValidationResult<SourceSystem> {
    return this.validate("source-system.schema.json", data);
  }

  validateCopSubscription<T = unknown>(data: unknown): ContractValidationResult<T> {
    return this.validate("cop-subscription.schema.json", data);
  }

  validateSymbolResolveRequest<T = unknown>(data: unknown): ContractValidationResult<T> {
    return this.validate("symbol-resolve-request.schema.json", data);
  }

  validateAiCopQuery<T = unknown>(data: unknown): ContractValidationResult<T> {
    return this.validate("ai-cop-query.schema.json", data);
  }

  validate<T>(schemaName: ContractSchemaName, data: unknown): ContractValidationResult<T> {
    const validator = this.getValidator(schemaName);
    const valid = validator(data);
    return valid
      ? { valid: true, data: data as T }
      : { valid: false, errors: validator.errors ?? [] };
  }

  private getValidator(schemaName: ContractSchemaName): ValidateFunction {
    const existing = this.validators.get(schemaName);
    if (existing) {
      return existing;
    }

    const schema = loadSchema(schemaName);
    const id = schema.$id;
    const validator =
      typeof id === "string" ? this.ajv.getSchema(id) ?? this.ajv.compile(schema) : this.ajv.compile(schema);
    this.validators.set(schemaName, validator);
    return validator;
  }
}

export function formatValidationErrors(errors: ErrorObject[] | undefined): Array<{ path: string; issue: string }> {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || error.schemaPath,
    issue: error.message ?? "validation failed"
  }));
}
