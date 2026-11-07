import { describe, expect, it } from "vitest";
import { forEachCooperatively } from "./cooperative-batch.js";

describe("cooperative producer admission", () => {
  it("preserves every result and order while letting a real timer run before completion", async () => {
    const values = Array.from({ length: 256 }, (_, i) => i), seen: number[] = [];
    let timerSaw = -1, checkpoints = 0;
    const timer = new Promise<void>(resolve => setTimeout(() => { timerSaw = seen.length; resolve(); }, 0));
    expect(await forEachCooperatively(values, value => {
      seen.push(value);
      const until = performance.now() + 0.25;
      while (performance.now() < until) { /* synthetic synchronous work */ }
    }, {
      checkpoint: async () => { checkpoints++; }, cancelled: () => false
    })).toBe(true);
    await timer;
    expect(seen).toEqual(values);
    expect(timerSaw).toBeGreaterThan(0);
    expect(timerSaw).toBeLessThan(values.length);
    expect(checkpoints).toBeGreaterThan(1);
  });

  it("uses the elapsed-time budget even before the item-count bound", async () => {
    let elapsed = 0, yields = 0;
    const seen: number[] = [];
    await forEachCooperatively([1, 2, 3], value => { seen.push(value); elapsed += 9; }, {
      checkpoint: async () => {}, cancelled: () => false, clock: () => elapsed,
      yieldToLoop: async () => { yields++; }
    });
    expect(seen).toEqual([1, 2, 3]); expect(yields).toBe(2);
  });

  it("checks the changed generation after yielding before processing another item", async () => {
    let generation = 1;
    const seen: number[] = [];
    await expect(forEachCooperatively(Array.from({ length: 64 }, (_, i) => i), value => seen.push(value), {
      checkpoint: async () => { if (generation !== 1) throw Error("FENCED"); },
      cancelled: () => false, clock: () => 0,
      yieldToLoop: async () => { generation = 2; }
    })).rejects.toThrow("FENCED");
    expect(seen).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it("honors cancellation during yield and before startup", async () => {
    let closing = false, checkpoints = 0;
    const seen: number[] = [];
    expect(await forEachCooperatively(Array.from({ length: 64 }, (_, i) => i), value => seen.push(value), {
      checkpoint: async () => { checkpoints++; }, cancelled: () => closing,
      clock: () => 0, yieldToLoop: async () => { closing = true; }
    })).toBe(false);
    expect(seen).toHaveLength(32); expect(checkpoints).toBe(1);
    expect(await forEachCooperatively([1], () => { throw Error("must not run"); }, {
      checkpoint: async () => { throw Error("must not run"); }, cancelled: () => true
    })).toBe(false);
  });
});
