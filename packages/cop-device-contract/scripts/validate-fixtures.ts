import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

interface FixtureCase {
  file: string;
  schema: string;
  valid: boolean;
}

interface FixtureManifest {
  contractVersion: string;
  cases: FixtureCase[];
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function validateContractFixtures(): string[] {
  const schemaDirectory = join(packageRoot, "schemas");
  const fixtureDirectory = join(packageRoot, "fixtures", "v1");
  const manifest = readJson<FixtureManifest>(join(fixtureDirectory, "manifest.json"));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
  addFormats(ajv);

  for (const file of readdirSync(schemaDirectory).filter((entry) => entry.endsWith(".schema.json"))) {
    ajv.addSchema(readJson(join(schemaDirectory, file)));
  }

  const failures: string[] = [];
  for (const fixture of manifest.cases) {
    const schemaId = `https://cop.local/device/v1/${fixture.schema}`;
    const validate = ajv.getSchema(schemaId);
    if (!validate) {
      failures.push(`${fixture.file}: schema ${fixture.schema} is not registered`);
      continue;
    }
    const actual = validate(readJson(join(fixtureDirectory, fixture.file)));
    if (actual !== fixture.valid) {
      failures.push(
        `${fixture.file}: expected valid=${fixture.valid}, got ${actual}; ${formatErrors(validate.errors)}`
      );
    }
  }
  return failures;
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`).join("; ") ?? "";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const failures = validateContractFixtures();
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("COP Device contract fixtures are valid.");
  }
}
