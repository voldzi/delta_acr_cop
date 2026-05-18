export interface EdgeNodeStatus {
  mode: "ONLINE" | "DEGRADED" | "OFFLINE";
  cachedSnapshotObjects: number;
  outboxItems: number;
  lastSyncAt: string | null;
}

export function createInitialEdgeStatus(): EdgeNodeStatus {
  return {
    mode: "DEGRADED",
    cachedSnapshotObjects: 0,
    outboxItems: 0,
    lastSyncAt: null
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(createInitialEdgeStatus(), null, 2));
}
