export const offlineSnapshotMinimumIntervalMs = 10_000;
export const offlineSnapshotSettleDelayMs = 400;

export function nextOfflineSnapshotPersistDelay(
  lastPersistedAt: number,
  now = Date.now(),
  minimumIntervalMs = offlineSnapshotMinimumIntervalMs,
  settleDelayMs = offlineSnapshotSettleDelayMs
): number {
  if (!Number.isFinite(lastPersistedAt) || lastPersistedAt <= 0) {
    return settleDelayMs;
  }
  const elapsed = Math.max(0, now - lastPersistedAt);
  return Math.max(settleDelayMs, minimumIntervalMs - elapsed);
}

export function shouldLoadWeatherWebcamDetail(status: "error" | "loading" | "ready" | undefined): boolean {
  return status === undefined || status === "error";
}

export function weatherWebcamDetailCandidateKey(candidates: readonly { detailUrl: string; key: string }[]): string {
  return candidates
    .map(({ detailUrl, key }) => `${key}\u0000${detailUrl}`)
    .sort()
    .join("\u0001");
}

export async function mapWithConcurrency<T, Result>(
  items: readonly T[],
  requestedConcurrency: number,
  mapper: (item: T, index: number) => Promise<Result>
): Promise<Result[]> {
  if (items.length === 0) {
    return [];
  }
  const concurrency = Math.max(1, Math.min(items.length, Math.trunc(requestedConcurrency) || 1));
  const tasks = items.map((item, index) => ({ index, item }));
  const results = new Array<Result>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      if (!task) {
        return;
      }
      results[task.index] = await mapper(task.item, task.index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
