import { describe, expect, it, vi } from "vitest";

import { createAsyncRefreshCoordinator } from "./async-refresh-coordinator";

describe("createAsyncRefreshCoordinator", () => {
  it("shares one request across simultaneous lifecycle events", async () => {
    let resolveLoad: ((value: string) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const onSuccess = vi.fn();
    const coordinator = createAsyncRefreshCoordinator({ load, onError: vi.fn(), onSuccess });

    const first = coordinator.refresh();
    const second = coordinator.refresh();

    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad?.("ready");
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("throttles duplicate focus and visibility refreshes but allows an explicit refresh", async () => {
    let now = 1_000;
    const load = vi.fn().mockResolvedValue("ready");
    const coordinator = createAsyncRefreshCoordinator({
      load,
      minimumIntervalMs: 5_000,
      now: () => now,
      onError: vi.fn(),
      onSuccess: vi.fn()
    });

    await expect(coordinator.refresh()).resolves.toBe(true);
    now += 100;
    await expect(coordinator.refresh()).resolves.toBe(false);
    await expect(coordinator.refresh({ force: true })).resolves.toBe(true);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reports a failed refresh and permits a later retry", async () => {
    let now = 1_000;
    const onError = vi.fn();
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("ready");
    const coordinator = createAsyncRefreshCoordinator({
      load,
      now: () => now,
      onError,
      onSuccess: vi.fn()
    });

    await expect(coordinator.refresh()).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
    now += 5_001;
    await expect(coordinator.refresh()).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
