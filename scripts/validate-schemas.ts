import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createAjv } from "../packages/ingest-contracts/src/index.js";

const schemaDir = join(process.cwd(), "docs", "api", "schemas");
const files = readdirSync(schemaDir).filter((file) => file.endsWith(".json"));

for (const file of files) {
  JSON.parse(readFileSync(join(schemaDir, file), "utf8"));
}

createAjv();
console.log(`Validated ${files.length} JSON Schema files.`);
