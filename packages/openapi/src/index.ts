import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "docs", "api", "openapi-main-cop.yaml"))) {
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

export function getOpenApiPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(findWorkspaceRoot(here), "docs", "api", "openapi-main-cop.yaml");
}

export function getSchemaPath(schemaName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(findWorkspaceRoot(here), "docs", "api", "schemas", schemaName);
}
