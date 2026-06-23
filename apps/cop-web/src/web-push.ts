export type WebPushStatus = "unsupported" | "disabled" | "available" | "permission-denied" | "registered" | "degraded";

export interface WebPushUiState {
  detail?: string;
  deviceId?: string;
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  registered: boolean;
  status: WebPushStatus;
  warnings: string[];
}

interface WebPushConfigResponse {
  enabled: boolean;
  status: "disabled" | "degraded" | "online";
  vapidPublicKey?: string;
  warnings?: string[];
}

interface WebPushDeviceRegistrationResponse {
  deviceId?: string;
  registered: boolean;
  status: "disabled" | "degraded" | "online";
  warnings?: string[];
}

const webPushDeviceIdStorageKey = "cop.webPush.deviceId.v1";
const serviceWorkerPath = "/cop-service-worker.js";

export function readWebPushPermissionState(): WebPushUiState {
  if (!isWebPushSupported()) {
    return {
      enabled: false,
      permission: "unsupported",
      registered: false,
      status: "unsupported",
      warnings: ["Tento prohlížeč nepodporuje webové push notifikace."]
    };
  }

  const deviceId = readStoredDeviceId();
  const permission = Notification.permission;
  return {
    ...(deviceId ? { deviceId } : {}),
    enabled: false,
    permission,
    registered: Boolean(deviceId) && permission === "granted",
    status: permission === "denied" ? "permission-denied" : Boolean(deviceId) && permission === "granted" ? "registered" : "available",
    warnings: []
  };
}

export async function fetchWebPushConfig(apiBase: string): Promise<WebPushUiState> {
  if (!isWebPushSupported()) {
    return readWebPushPermissionState();
  }

  const config = await fetchJson<WebPushConfigResponse>(`${apiBase}/api/v1/push/web/config`);
  const current = readWebPushPermissionState();
  if (!config.enabled || config.status === "disabled") {
    return {
      ...current,
      enabled: false,
      registered: false,
      status: "disabled",
      warnings: config.warnings ?? []
    };
  }

  if (config.status === "degraded" || !config.vapidPublicKey) {
    return {
      ...current,
      enabled: false,
      registered: false,
      status: "degraded",
      warnings: config.warnings?.length ? config.warnings : ["Webové notifikace nejsou připravené."]
    };
  }

  return {
    ...current,
    enabled: true,
    status: current.status === "registered" ? "registered" : current.status === "permission-denied" ? "permission-denied" : "available",
    warnings: config.warnings ?? []
  };
}

export async function enableWebPushNotifications(apiBase: string, token: string): Promise<WebPushUiState> {
  if (!isWebPushSupported()) {
    return readWebPushPermissionState();
  }

  const config = await fetchJson<WebPushConfigResponse>(`${apiBase}/api/v1/push/web/config`);
  if (!config.enabled || !config.vapidPublicKey) {
    return {
      enabled: false,
      permission: Notification.permission,
      registered: false,
      status: config.status === "degraded" ? "degraded" : "disabled",
      warnings: config.warnings?.length ? config.warnings : ["Webové notifikace nejsou na serveru zapnuté."]
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      enabled: true,
      permission,
      registered: false,
      status: "permission-denied",
      warnings: ["Prohlížeč nepovolil zobrazování notifikací."]
    };
  }

  const registration = await navigator.serviceWorker.register(serviceWorkerPath);
  const subscription = await subscribeBrowser(registration, config.vapidPublicKey);
  const deviceId = readStoredDeviceId() ?? createWebPushDeviceId();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetchJson<WebPushDeviceRegistrationResponse>(`${apiBase}/api/v1/push/web/devices`, {
    body: JSON.stringify({
      capabilities: ["notifications", "deep_links"],
      deviceId,
      locale: navigator.language,
      notificationPreferences: {
        safetyAlerts: true,
        system: true
      },
      subscription: subscription.toJSON(),
      timezone
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  const storedDeviceId = response.deviceId ?? deviceId;
  storeDeviceId(storedDeviceId);

  return {
    detail: response.status,
    deviceId: storedDeviceId,
    enabled: true,
    permission,
    registered: response.registered,
    status: response.registered ? "registered" : response.status === "degraded" ? "degraded" : "disabled",
    warnings: response.warnings ?? []
  };
}

export async function disableWebPushNotifications(apiBase: string, token: string): Promise<WebPushUiState> {
  if (!isWebPushSupported()) {
    return readWebPushPermissionState();
  }

  const deviceId = readStoredDeviceId();
  if (deviceId) {
    await fetchJson<WebPushDeviceRegistrationResponse>(`${apiBase}/api/v1/push/web/devices/${encodeURIComponent(deviceId)}`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      method: "DELETE"
    });
  }

  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  clearStoredDeviceId();

  return {
    enabled: true,
    permission: Notification.permission,
    registered: false,
    status: Notification.permission === "denied" ? "permission-denied" : "available",
    warnings: []
  };
}

async function subscribeBrowser(registration: ServiceWorkerRegistration, vapidPublicKey: string): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }

  return registration.pushManager.subscribe({
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    userVisibleOnly: true
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init
  });
  if (!response.ok) {
    throw new Error(`${response.status} API request failed for ${new URL(url, window.location.origin).pathname}`);
  }
  return response.json() as Promise<T>;
}

function isWebPushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function createWebPushDeviceId(): string {
  if ("randomUUID" in crypto) {
    return `web_${crypto.randomUUID()}`;
  }
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function readStoredDeviceId(): string | undefined {
  try {
    return window.localStorage.getItem(webPushDeviceIdStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeDeviceId(deviceId: string): void {
  try {
    window.localStorage.setItem(webPushDeviceIdStorageKey, deviceId);
  } catch {
    // Registration still succeeds server-side; local persistence is a browser convenience.
  }
}

function clearStoredDeviceId(): void {
  try {
    window.localStorage.removeItem(webPushDeviceIdStorageKey);
  } catch {
    // Best effort.
  }
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}
