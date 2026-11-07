import { setImmediate } from "node:timers/promises";

/** Bound one producer's synchronous burst without extending any admission lease. */
export async function forEachCooperatively<T>(items: readonly T[], work: (item: T) => void, options: {
  checkpoint(): Promise<void>;
  cancelled(): boolean;
  yieldToLoop?: () => Promise<unknown>;
  clock?: () => number;
}): Promise<boolean> {
  const clock = options.clock ?? performance.now.bind(performance);
  const yieldToLoop = options.yieldToLoop ?? setImmediate;
  if (options.cancelled()) return false;
  await options.checkpoint();
  let started = clock(), count = 0;
  for (const item of items) {
    if (options.cancelled()) return false;
    if (count >= 32 || (count > 0 && clock() - started >= 8)) {
      await yieldToLoop();
      if (options.cancelled()) return false;
      // Re-read the real frontier after scheduling other requests/writers.
      await options.checkpoint();
      if (options.cancelled()) return false;
      started = clock(); count = 0;
    }
    work(item); count++;
  }
  return !options.cancelled();
}
