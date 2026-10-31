/** Synthetic diagnostic only: no server, accounts, database or external I/O.
 * Run: node --import tsx scripts/benchmark-cop-projection-admission.mjs
 * This is not a production CPU profile or a hardware-independent CI threshold.
 */
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { createInitialState } from "../apps/cop-api/src/state.ts";
import { installCopStateProjectionOwner } from "../apps/cop-api/src/cop-state-erasure.ts";

const state = createInitialState();
let deadline = Infinity;
const point = i => ({
  objectId: "synthetic-only", sourceSystemId: "synthetic-source",
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  lat: 50 + i / 100000, lon: 15 + i / 100000,
  affiliation: "NEUTRAL", status: "ACTIVE", objectType: "VEHICLE", domain: "LAND"
});
const port = installCopStateProjectionOwner(state, {
  issuer: "https://identity.synthetic.test/realms/cop",
  cachedGuard: { ready: () => performance.now() < deadline, version: () => 1, assertActorAllowed: () => {} },
  loadFences: async () => ({ resources: [], ownerHashes: [], subjectHashes: [], version: "synthetic" }),
  retainedCopies: {
    ready: async () => true, preflight: async () => ({ ready: true, version: "synthetic" }), erase: async () => true
  }
});
await port.init();
state.trackHistory.set("synthetic-only", Array.from({ length: 5000 }, (_, i) => point(i)));
await sleep(20);
const start = performance.now();
deadline = start + 5000;
let timerObserved = 0;
const timer = new Promise(resolve => setTimeout(() => {
  timerObserved = performance.now() - start;
  resolve();
}, 1000));
let completed = 0, failureCode = null;
try {
  for (let i = 0; i < 128; i++) {
    const old = state.trackHistory.get("synthetic-only");
    state.trackHistory.set("synthetic-only", [...old.slice(-4999), point(5000 + i)]);
    completed++;
  }
} catch (error) {
  failureCode = error.code ?? "UNKNOWN";
}
const blocking = performance.now() - start;
await timer;
console.log(JSON.stringify({
  syntheticOnly: true, productionHotspotProof: false, historyCapacity: 5000, attemptedBatch: 128,
  completed, leaseMs: 5000, failureCode, synchronousBlockMs: +blocking.toFixed(2),
  oneSecondTimerObservedMs: +timerObserved.toFixed(2)
}));
