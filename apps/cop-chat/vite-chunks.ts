export function chatChunkFileName(chunkInfo: { moduleIds: string[] }): string {
  return chunkInfo.moduleIds.some((id) => id.includes("/node_modules/matrix-js-sdk/"))
    ? "assets/matrix-[hash].js"
    : "assets/[name]-[hash].js";
}

export function chatManualChunk(id: string): string | undefined {
  if (
    id.includes("/node_modules/react/") ||
    id.includes("/node_modules/react-dom/") ||
    id.includes("/node_modules/scheduler/")
  ) {
    return "react-runtime";
  }
  // Matrix is already reached through a dynamic import in matrixClient. Let the
  // bundler keep that async graph separate; forcing a manual chunk can pull the
  // shared preload helper into it and make the logged-out shell import it.
  return undefined;
}
