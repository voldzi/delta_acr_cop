import fs from "node:fs";
import YAML from "yaml";

const jsonPath = "openapi/openapi.json";
const yamlPath = "docs/api/openapi-main-cop.yaml";

const contract = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const yaml = YAML.stringify(contract, { lineWidth: 100 });

fs.writeFileSync(
  yamlPath,
  `# This file is generated from openapi/openapi.json.\n# Do not edit manually.\n\n${yaml}`
);
