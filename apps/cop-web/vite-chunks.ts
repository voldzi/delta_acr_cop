type ModuleGraph = {
  getModuleInfo(id: string): {
    importers: readonly string[];
    dynamicImporters: readonly string[];
  } | null;
};

function isCesium(id: string): boolean {
  return id.includes("/node_modules/cesium/") || id.includes("/node_modules/@cesium/");
}

// Only move a dependency into the optional engine when every importer leads
// back to Cesium. Shared preload/runtime helpers and 2D-map dependencies must
// remain separate, or opening the 2D map can download the entire 3D engine.
function isExclusiveCesiumDependency(id: string, graph: ModuleGraph): boolean {
  const pending = [id];
  const visited = new Set<string>();
  let reachesCesium = false;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (isCesium(current)) {
      reachesCesium = true;
      continue;
    }
    if (!current.includes("/node_modules/")) return false;
    const info = graph.getModuleInfo(current);
    if (!info) return false;
    const importers = [...info.importers, ...info.dynamicImporters];
    if (importers.length === 0) return false;
    pending.push(...importers);
  }
  return reachesCesium;
}

export function webChunkName(id: string, graph: ModuleGraph): string | undefined {
  if (
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/scheduler/")
  )
    return "react-runtime";
  if (id.includes("/node_modules/lucide-react/")) return "icons";
  if (id.includes("/node_modules/@radix-ui/")) return "radix-ui";
  if (id.includes("/node_modules/maplibre-gl/")) return "maplibre";
  if (id.includes("/packages/geo-client/")) return "geo-client";
  if (id.includes("/node_modules/qrcode/")) return "qrcode";
  if (isCesium(id) || isExclusiveCesiumDependency(id, graph)) return "cesium";
  return undefined;
}
