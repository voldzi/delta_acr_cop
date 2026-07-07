export type WebPushStatus = "unsupported" | "disabled" | "available" | "permission-denied" | "registered" | "degraded";

export interface WebPushUiState {
  detail?: string;
  deviceId?: string;
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  registered: boolean;
  registrationConfirmedAt?: string;
  serviceWorkerReady?: boolean;
  standalone: boolean;
  status: WebPushStatus;
  subscriptionActive?: boolean;
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
const webPushRegistrationStorageKey = "cop.webPush.registration.v1";
const serviceWorkerPath = "/cop-service-worker.js";
const serviceWorkerScope = "/";

interface StoredWebPushRegistration {
  deviceId: string;
  registeredAt: string;
  status: "online";
}

export function readWebPushPermissionState(): WebPushUiState {
  if (!isWebPushSupported()) {
    return {
      enabled: false,
      permission: "unsupported",
      registered: false,
      standalone: isPwaStandalone(),
      status: "unsupported",
      warnings: ["Tento prohlížeč nepodporuje webové push notifikace."]
    };
  }

  const confirmedRegistration = readStoredRegistration();
  const deviceId = confirmedRegistration?.deviceId ?? readStoredDeviceId();
  const permission = Notification.permission;
  const registered = Boolean(confirmedRegistration) && permission === "granted";
  return {
    ...(deviceId ? { deviceId } : {}),
    enabled: false,
    permission,
    registered,
    ...(confirmedRegistration ? { registrationConfirmedAt: confirmedRegistration.registeredAt } : {}),
    standalone: isPwaStandalone(),
    status:
      permission === "denied"
        ? "permission-denied"
        : registered
          ? "registered"
          : "available",
    warnings: []
  };
}

export async function fetchWebPushConfig(apiBase: string): Promise<WebPushUiState> {
  if (!isWebPushSupported()) {
    return readWebPushPermissionState();
  }

  const config = await fetchJson<WebPushConfigResponse>(`${apiBase}/api/v1/push/web/config`);
  const current = readWebPushPermissionState();
  const browserState = await readBrowserPushState();
  if (!config.enabled || config.status === "disabled") {
    return {
      ...current,
      enabled: false,
      registered: false,
      serviceWorkerReady: browserState.serviceWorkerReady,
      status: "disabled",
      subscriptionActive: browserState.subscriptionActive,
      warnings: config.warnings ?? []
    };
  }

  if (config.status === "degraded" || !config.vapidPublicKey) {
    return {
      ...current,
      enabled: false,
      registered: false,
      serviceWorkerReady: browserState.serviceWorkerReady,
      status: "degraded",
      subscriptionActive: browserState.subscriptionActive,
      warnings: config.warnings?.length ? config.warnings : ["Webové notifikace nejsou připravené."]
    };
  }

  const hasStoredRegistration = Boolean(current.deviceId) && current.permission === "granted";
  const confirmedRegistration = readStoredRegistration();
  const hasConfirmedRegistration =
    Boolean(confirmedRegistration?.deviceId) && current.permission === "granted";
  const registered = hasConfirmedRegistration && browserState.subscriptionActive;
  const staleWarnings =
    hasStoredRegistration && !browserState.subscriptionActive
      ? ["Registrace tohoto prohlížeče není aktivní. Zapněte webové notifikace znovu."]
      : browserState.subscriptionActive && !hasConfirmedRegistration
        ? ["Prohlížeč má aktivní push odběr, ale COP registrace není potvrzená. Zapněte webové notifikace znovu."]
        : [];

  return {
    ...current,
    enabled: true,
    registered,
    ...(confirmedRegistration ? { registrationConfirmedAt: confirmedRegistration.registeredAt } : {}),
    serviceWorkerReady: browserState.serviceWorkerReady,
    status: registered
      ? "registered"
      : current.status === "permission-denied"
        ? "permission-denied"
        : browserState.subscriptionActive && !hasConfirmedRegistration
          ? "degraded"
          : "available",
    subscriptionActive: browserState.subscriptionActive,
    warnings: [...(config.warnings ?? []), ...staleWarnings]
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
      standalone: isPwaStandalone(),
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
      standalone: isPwaStandalone(),
      status: "permission-denied",
      warnings: ["Prohlížeč nepovolil zobrazování notifikací."]
    };
  }

  const registration = await ensureServiceWorkerRegistration();
  const subscription = await subscribeBrowser(registration, config.vapidPublicKey);
  const deviceId = readStoredDeviceId() ?? createWebPushDeviceId();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetchJson<WebPushDeviceRegistrationResponse>(
    `${apiBase}/api/v1/push/web/devices`,
    {
      body: JSON.stringify({
        capabilities: ["notifications", "deep_links"],
        deviceId,
        locale: navigator.language,
        notificationPreferences: {
          chatMessages: true,
          communityReports: true,
          safetyAlerts: true,
          system: true,
          watchedAreaAlerts: true
        },
        subscription: subscription.toJSON(),
        timezone
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    },
    { acceptedErrorStatuses: [502, 503] }
  );

  const storedDeviceId = response.deviceId ?? deviceId;
  const registeredAt = new Date().toISOString();
  if (response.registered) {
    storeDeviceId(storedDeviceId);
    storeConfirmedRegistration({
      deviceId: storedDeviceId,
      registeredAt,
      status: "online"
    });
  } else {
    clearStoredRegistration();
  }

  return {
    detail: response.status,
    ...(response.registered ? { deviceId: storedDeviceId } : {}),
    enabled: true,
    permission,
    registered: response.registered,
    ...(response.registered ? { registrationConfirmedAt: registeredAt } : {}),
    serviceWorkerReady: Boolean(registration.active ?? registration.waiting ?? registration.installing),
    standalone: isPwaStandalone(),
    status: response.registered ? "registered" : response.status === "degraded" ? "degraded" : "disabled",
    subscriptionActive: true,
    warnings: response.warnings ?? []
  };
}

export async function disableWebPushNotifications(apiBase: string, token: string): Promise<WebPushUiState> {
  if (!isWebPushSupported()) {
    return readWebPushPermissionState();
  }

  const deviceId = readStoredDeviceId();
  if (deviceId) {
    await fetchJson<WebPushDeviceRegistrationResponse>(
      `${apiBase}/api/v1/push/web/devices/${encodeURIComponent(deviceId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        method: "DELETE"
      }
    );
  }

  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  clearStoredDeviceId();
  clearStoredRegistration();

  return {
    enabled: true,
    permission: Notification.permission,
    registered: false,
    serviceWorkerReady: Boolean(registration?.active ?? registration?.waiting ?? registration?.installing),
    standalone: isPwaStandalone(),
    status: Notification.permission === "denied" ? "permission-denied" : "available",
    subscriptionActive: false,
    warnings: []
  };
}

async function subscribeBrowser(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string
): Promise<PushSubscription> {
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && pushSubscriptionUsesApplicationServerKey(existing, applicationServerKey)) {
    return existing;
  }
  if (existing) {
    await existing.unsubscribe().catch(() => undefined);
  }

  return registration.pushManager.subscribe({
    applicationServerKey,
    userVisibleOnly: true
  });
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(serviceWorkerPath, {
    scope: serviceWorkerScope,
    updateViaCache: "none"
  });
  await registration.update().catch(() => undefined);
  return navigator.serviceWorker.ready;
}

async function readBrowserPushState(): Promise<{ serviceWorkerReady: boolean; subscriptionActive: boolean }> {
  if (!isWebPushSupported()) {
    return { serviceWorkerReady: false, subscriptionActive: false };
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope);
    const subscription = await registration?.pushManager.getSubscription();
    return {
      serviceWorkerReady: Boolean(registration?.active ?? registration?.waiting ?? registration?.installing),
      subscriptionActive: Boolean(subscription)
    };
  } catch {
    return { serviceWorkerReady: false, subscriptionActive: false };
  }
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  options: { acceptedErrorStatuses?: number[] } = {}
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init
  });
  const acceptedError = options.acceptedErrorStatuses?.includes(response.status) ?? false;
  if (!response.ok && !acceptedError) {
    throw new Error(`${response.status} API request failed for ${new URL(url, window.location.origin).pathname}`);
  }
  return response.json() as Promise<T>;
}

function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
  );
}

function isPwaStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function pushSubscriptionUsesApplicationServerKey(
  subscription: PushSubscription,
  expectedKey: Uint8Array<ArrayBuffer>
): boolean {
  const existingKey = subscription.options.applicationServerKey;
  if (!existingKey) {
    return true;
  }
  const existing = new Uint8Array(existingKey);
  if (existing.byteLength !== expectedKey.byteLength) {
    return false;
  }
  return existing.every((value, index) => value === expectedKey[index]);
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

function readStoredRegistration(): StoredWebPushRegistration | undefined {
  try {
    const raw = window.localStorage.getItem(webPushRegistrationStorageKey);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<StoredWebPushRegistration>;
    if (typeof parsed.deviceId !== "string" || typeof parsed.registeredAt !== "string") {
      return undefined;
    }
    return {
      deviceId: parsed.deviceId,
      registeredAt: parsed.registeredAt,
      status: "online"
    };
  } catch {
    return undefined;
  }
}

function storeConfirmedRegistration(registration: StoredWebPushRegistration): void {
  try {
    window.localStorage.setItem(webPushRegistrationStorageKey, JSON.stringify(registration));
  } catch {
    // Registration still succeeds server-side; local persistence is a browser convenience.
  }
}

function clearStoredRegistration(): void {
  try {
    window.localStorage.removeItem(webPushRegistrationStorageKey);
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
