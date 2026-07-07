// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableWebPushNotifications, fetchWebPushConfig } from "./web-push";

const storedDeviceIdKey = "cop.webPush.deviceId.v1";
const storedRegistrationKey = "cop.webPush.registration.v1";

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
    vi.stubGlobal(
      "fetch",
      createFetchMock([{ enabled: true, status: "online", vapidPublicKey: base64Url("current-key") }])
    );

    const state = await fetchWebPushConfig("");

    expect(state.enabled).toBe(true);
    expect(state.registered).toBe(false);
    expect(state.serviceWorkerReady).toBe(true);
    expect(state.subscriptionActive).toBe(false);
    expect(state.status).toBe("available");
    expect(state.warnings.join(" ")).toContain("není aktivní");
  });

  it("does not report a legacy stored device as registered without confirmed COP registration", async () => {
    window.localStorage.setItem(storedDeviceIdKey, "web_existing");
    const registration = createRegistration({
      subscription: {
        options: { applicationServerKey: null, userVisibleOnly: true },
        toJSON: () => ({ endpoint: "https://push.example/existing" }),
        unsubscribe: vi.fn().mockResolvedValue(true)
      }
    });
    defineServiceWorker({
      getRegistration: vi.fn().mockResolvedValue(registration)
    });
    vi.stubGlobal(
      "fetch",
      createFetchMock([{ enabled: true, status: "online", vapidPublicKey: base64Url("current-key") }])
    );

    const state = await fetchWebPushConfig("");

    expect(state.enabled).toBe(true);
    expect(state.registered).toBe(false);
    expect(state.subscriptionActive).toBe(true);
    expect(state.status).toBe("degraded");
    expect(state.warnings.join(" ")).toContain("není potvrzená");
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
    expect(JSON.parse(String(window.localStorage.getItem(storedRegistrationKey)))).toMatchObject({
      deviceId: "web_registered",
      status: "online"
    });
  });

  it("returns a degraded registration state from structured API errors", async () => {
    const subscribe = vi.fn().mockResolvedValue({
      toJSON: () => ({ endpoint: "https://push.example/new", keys: { auth: "auth", p256dh: "key" } })
    });
    const registration = createRegistration({
      subscribe,
      subscription: null
    });
    defineServiceWorker({
      ready: Promise.resolve(registration),
      register: vi.fn().mockResolvedValue(registration)
    });
    vi.stubGlobal(
      "fetch",
      createFetchMock([
        { enabled: true, status: "online", vapidPublicKey: base64Url("new-key") },
        {
          body: {
            deviceId: "web_pending",
            registered: false,
            status: "degraded",
            warnings: ["Messaging device registration returned HTTP 500."]
          },
          ok: false,
          status: 502
        }
      ])
    );

    const state = await enableWebPushNotifications("", "access-token");

    expect(state.registered).toBe(false);
    expect(state.status).toBe("degraded");
    expect(state.subscriptionActive).toBe(true);
    expect(state.warnings.join(" ")).toContain("HTTP 500");
    expect(window.localStorage.getItem(storedRegistrationKey)).toBeNull();
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

type FetchMockItem = unknown | { body: unknown; ok: boolean; status: number };

function createFetchMock(payloads: FetchMockItem[]) {
  const queue = [...payloads];
  return vi.fn().mockImplementation(async () => {
    const item = queue.shift();
    if (isFetchMockResponse(item)) {
      return {
        json: async () => item.body,
        ok: item.ok,
        status: item.status
      };
    }
    return {
      json: async () => item,
      ok: true,
      status: 200
    };
  });
}

function isFetchMockResponse(value: FetchMockItem): value is { body: unknown; ok: boolean; status: number } {
  return typeof value === "object" && value !== null && "body" in value && "ok" in value && "status" in value;
}

function base64Url(value: string): string {
  return window.btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}
