# OpenAPI Contract

`openapi/openapi.json` is the binding REST API contract for COP.

Rules:

- Edit or generate `openapi/openapi.json` first.
- Do not hand-edit `docs/api/openapi-main-cop.yaml`.
- Regenerate the compatibility YAML export with:

```bash
pnpm openapi:sync-yaml
```

Validation:

```bash
pnpm validate:openapi
```

The YAML export remains at `docs/api/openapi-main-cop.yaml` for existing
documentation links and tools. It is generated from JSON and starts with the
required generated-file header.
