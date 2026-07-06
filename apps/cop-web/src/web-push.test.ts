// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableWebPushNotifications, fetchWebPushConfig } from "./web-push";

const storedDeviceIdKey = "cop.webPush.deviceId.v1";

beforeEach(() => {
  window.localStorage.clear();
  defineNotification("granted");
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManager() {}
  });
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web push browser state", () => {
  it("does not report a stale stored device as registered when browser subscription is missing", async () => {
    window.localStorage.setItem(storedDeviceIdKey, "web_existing");
    const registration = createRegistration({ subscription: null });
    defineServiceWorker({
      getRegistration: vi.fn().mockResolvedValue(registration)
    });
    vi.stubGlobal("fetch", createFetchMock([{ enabled: true, status: "online", vapidPublicKey: base64Url("current-key") }]));

    const state = await fetchWebPushConfig("");

    expect(state.enabled).toBe(true);
    expect(state.registered).toBe(false);
    expect(state.serviceWorkerReady).toBe(true);
    expect(state.subscriptionActive).toBe(false);
    expect(state.status).toBe("available");
    expect(state.warnings.join(" ")).toContain("není aktivní");
  });

  it("renews the browser subscription when the VAPID key changed", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscribe = vi.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: "https://push.example/new", keys: { auth: "auth", p256dh: "key" } })
    });
    const registration = createRegistration({
      subscribe,
      subscription: {
        options: { applicationServerKey: new TextEncoder().encode("old-key").buffer, userVisibleOnly: true },
        unsubscribe,
        toJSON: () => ({ endpoint: "https://push.example/old" })
      }
    });
    defineServiceWorker({
      ready: Promise.resolve(registration),
      register: vi.fn().mockResolvedValue(registration)
    });
    vi.stubGlobal(
      "fetch",
      createFetchMock([
        { enabled: true, status: "online", vapidPublicKey: base64Url("new-key") },
        { deviceId: "web_registered", registered: true, status: "online" }
      ])
    );

    const state = await enableWebPushNotifications("", "access-token");

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationServerKey: expect.any(Uint8Array),
        userVisibleOnly: true
      })
    );
    expect(state.registered).toBe(true);
    expect(state.subscriptionActive).toBe(true);
    expect(window.localStorage.getItem(storedDeviceIdKey)).toBe("web_registered");
  });
});

function defineNotification(permission: NotificationPermission): void {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission)
    }
  });
}

function defineServiceWorker(overrides: Partial<ServiceWorkerContainer>): void {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(undefined),
      ready: Promise.resolve(undefined),
      register: vi.fn().mockResolvedValue(undefined),
      ...overrides
    }
  });
}

function createRegistration({
  subscribe = vi.fn(),
  subscription
}: {
  subscribe?: ReturnType<typeof vi.fn>;
  subscription: PushSubscription | null | Pick<PushSubscription, "options" | "toJSON" | "unsubscribe">;
}): ServiceWorkerRegistration {
  return {
    active: {} as ServiceWorker,
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe
    },
    update: vi.fn().mockResolvedValue(undefined)
  } as unknown as ServiceWorkerRegistration;
}

function createFetchMock(payloads: unknown[]) {
  const queue = [...payloads];
  return vi.fn().mockImplementation(async () => ({
    json: async () => queue.shift(),
    ok: true
  }));
}

function base64Url(value: string): string {
  return window.btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
