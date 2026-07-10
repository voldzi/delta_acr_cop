import { afterEach, describe, expect, it, vi } from "vitest";

import { documentHasPwaUserDraft, isStalePwaReleaseError, registerCopPwaServiceWorker } from "./pwa-release.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PWA release recovery", () => {
  it("recognizes text and attachment drafts that must survive a worker update", () => {
    const querySelectorAll = vi.fn(() => [
      {
        files: undefined,
        getAttribute: () => null,
        hasAttribute: () => false,
        isContentEditable: false,
        value: "Rozepsané hlášení"
      }
    ]);
    vi.stubGlobal("document", { querySelectorAll });

    expect(documentHasPwaUserDraft()).toBe(true);
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });

  it("recognizes browser lazy-chunk failures", () => {
    expect(
      isStalePwaReleaseError(new Error("Failed to fetch dynamically imported module: /assets/CopMap-old.js"))
    ).toBe(true);
    expect(isStalePwaReleaseError(new Error("Loading chunk CopMap failed"))).toBe(true);
    expect(isStalePwaReleaseError(new Error("Importing a module script failed"))).toBe(true);
  });

  it("does not treat ordinary runtime failures as stale releases", () => {
    expect(isStalePwaReleaseError(new Error("Routing service returned 400"))).toBe(false);
  });

  it("retries an update and reloads once when a new worker replaces the active controller", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const update = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary update failure"))
      .mockResolvedValue(undefined);
    const registration = { update } as unknown as ServiceWorkerRegistration;
    const register = vi.fn(async () => registration);
    const controllerListeners: Array<() => void> = [];
    const initialController = { state: "activated" } as ServiceWorker;
    const nextController = { state: "activated" } as ServiceWorker;
    const serviceWorker = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "controllerchange") {
          controllerListeners.push(listener);
        }
      }),
      controller: initialController,
      register
    };
    const windowListeners = new Map<string, () => void>();
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: () => void) => windowListeners.set(type, listener)),
      location: { reload },
      setTimeout
    });
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      readyState: "complete",
      visibilityState: "visible"
    });
    vi.stubGlobal("navigator", { onLine: true, serviceWorker });

    registerCopPwaServiceWorker({ enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(register).toHaveBeenCalledWith("/cop-service-worker.js", {
      scope: "/",
      updateViaCache: "none"
    });
    expect(update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(update).toHaveBeenCalledTimes(2);
    expect(windowListeners.has("online")).toBe(true);

    serviceWorker.controller = nextController;
    controllerListeners[0]?.();
    controllerListeners[0]?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
