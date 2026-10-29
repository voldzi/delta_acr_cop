import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const copApiDirectory = fileURLToPath(new URL("../apps/cop-api/", import.meta.url));

/** Preserve pnpm start's package cwd without requiring Corepack at runtime. */
export async function startCopApi({
  changeDirectory = directory => process.chdir(directory),
  loadApi = () => import("../apps/cop-api/dist/index.js")
} = {}) {
  changeDirectory(copApiDirectory);
  await loadApi();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await startCopApi();
}
