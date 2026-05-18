import { app6MappingCatalog, localExtensionCatalog, type SymbolCatalogEntry } from "./catalog.js";
import type { SymbolResolution, SymbolResolveRequest } from "./types.js";

export type { SymbolResolution, SymbolResolveRequest } from "./types.js";
export { app6MappingCatalog, localExtensionCatalog } from "./catalog.js";

const standardVersion = "APP-6/STANAG-2019-compatible-mapping-baseline";

export function resolveSymbol(
  objectType: SymbolResolveRequest["objectType"],
  affiliation: SymbolResolveRequest["affiliation"],
  domain: SymbolResolveRequest["domain"],
  status: SymbolResolveRequest["status"],
  modifiers: Record<string, unknown> = {}
): SymbolResolution {
  const request: SymbolResolveRequest = {
    objectType,
    affiliation,
    domain,
    status,
    modifiers
  };

  const exact = findBestEntry(app6MappingCatalog, request);
  if (exact) {
    return buildResolution(exact, request, false, null);
  }

  const extension = findBestEntry(localExtensionCatalog, request);
  if (extension) {
    return buildResolution(extension, request, true, {
      catalog: "local-extension",
      reason: "No baseline APP-6 mapping matched; local extension fallback applied."
    });
  }

  return {
    symbolSet: "APP6",
    standardVersion,
    symbolCode: `APP6-${domain}-GENERIC-${affiliation}-${status}`,
    renderer: "SVG",
    modifiers: {
      affiliation,
      domain,
      status,
      ...modifiers
    },
    fallback: true,
    extension: null,
    warnings: ["Generic domain fallback applied."]
  };
}

export function resolveSymbolFromRequest(request: SymbolResolveRequest): SymbolResolution {
  return resolveSymbol(request.objectType, request.affiliation, request.domain, request.status, request.modifiers ?? {});
}

function buildResolution(
  entry: SymbolCatalogEntry,
  request: SymbolResolveRequest,
  fallback: boolean,
  extension: SymbolResolution["extension"]
): SymbolResolution {
  return {
    symbolSet: "APP6",
    standardVersion,
    symbolCode: entry.symbolCode,
    renderer: "SVG",
    modifiers: {
      affiliation: request.affiliation,
      domain: request.domain,
      status: request.status,
      ...request.modifiers
    },
    fallback,
    extension,
    warnings: fallback ? [`Fallback mapping applied: ${entry.label}`] : []
  };
}

function findBestEntry(catalog: SymbolCatalogEntry[], request: SymbolResolveRequest): SymbolCatalogEntry | undefined {
  return catalog
    .filter((entry) => entry.objectType === request.objectType)
    .filter((entry) => entry.affiliation === "*" || entry.affiliation === request.affiliation)
    .filter((entry) => entry.domain === "*" || entry.domain === request.domain)
    .filter((entry) => entry.status === "*" || entry.status === request.status)
    .sort((a, b) => scoreEntry(b) - scoreEntry(a))[0];
}

function scoreEntry(entry: SymbolCatalogEntry): number {
  return [entry.affiliation, entry.domain, entry.status].filter((value) => value !== "*").length;
}
