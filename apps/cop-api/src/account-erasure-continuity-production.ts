import { lstatSync, readdirSync } from "node:fs";
import type { AccountErasureContinuity } from "./account-erasure-continuity.js";

/** Host Root must independently bind this read-only tree and the public socket
 * bootstrap to the accepted immutable image. Container UID0 alone is insufficient.
 * No caller-selected module, key, socket or positive authority callback. */
export async function loadAccountErasureContinuity(): Promise<AccountErasureContinuity> {
  const root = "/opt/cop-account-safety";
  let count = 0;
  const inspect = (path: string): void => {
    const s = lstatSync(path);
    if (s.uid !== 0 || (s.mode & 0o022) || !(s.isDirectory() || s.isFile() && s.nlink === 1)) throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
    if (s.isDirectory()) for (const name of readdirSync(path)) {
      if (++count > 20_000) throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
      inspect(path + "/" + name);
    }
  };
  for (const parent of ["/", "/opt"]) {
    const s = lstatSync(parent);
    if (!s.isDirectory() || s.uid !== 0 || (s.mode & 0o022)) throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
  }
  inspect(root);
  const moduleUrl = "file:///opt/cop-account-safety/cop-root-continuity.mjs";
  const module = await import(moduleUrl) as {
    createProductionAccountErasureContinuity?: () => AccountErasureContinuity;
  };
  if (typeof module.createProductionAccountErasureContinuity !== "function") throw new Error("ERASURE_CONTINUITY_INSTALLATION_UNAVAILABLE");
  return module.createProductionAccountErasureContinuity();
}
