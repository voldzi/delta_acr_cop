import { describe, expect, it, vi } from "vitest";

import { runVoiceMediaConnectSingleFlight } from "./useVoiceCallSession";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("runVoiceMediaConnectSingleFlight", () => {
  it("coalesces concurrent connections for the same call", async () => {
    const gate = deferred<void>();
    const connect = vi.fn(() => gate.promise);
    const flightRef = { current: null };

    const first = runVoiceMediaConnectSingleFlight(flightRef, "call-1", connect);
    const second = runVoiceMediaConnectSingleFlight(flightRef, "call-1", connect);

    expect(connect).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([first, second]);
    expect(flightRef.current).toBeNull();
  });

  it("waits for a different call connection before starting the next one", async () => {
    const firstGate = deferred<void>();
    const firstConnect = vi.fn(() => firstGate.promise);
    const secondConnect = vi.fn(async () => undefined);
    const flightRef = { current: null };

    const first = runVoiceMediaConnectSingleFlight(flightRef, "call-1", firstConnect);
    const second = runVoiceMediaConnectSingleFlight(flightRef, "call-2", secondConnect);

    await Promise.resolve();
    expect(secondConnect).not.toHaveBeenCalled();
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(secondConnect).toHaveBeenCalledTimes(1);
    expect(flightRef.current).toBeNull();
  });

  it("clears a failed connection so the same call can retry", async () => {
    const connectError = new Error("media unavailable");
    const failedConnect = vi.fn(async () => {
      throw connectError;
    });
    const retryConnect = vi.fn(async () => undefined);
    const flightRef = { current: null };

    await expect(runVoiceMediaConnectSingleFlight(flightRef, "call-1", failedConnect)).rejects.toBe(connectError);
    expect(flightRef.current).toBeNull();

    await runVoiceMediaConnectSingleFlight(flightRef, "call-1", retryConnect);
    expect(retryConnect).toHaveBeenCalledTimes(1);
    expect(flightRef.current).toBeNull();
  });
});
