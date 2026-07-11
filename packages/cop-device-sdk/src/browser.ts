import {
  COP_DEVICE_PROTOCOL_VERSION,
  type CapabilityDescriptor,
  type ConnectivityState,
  type CopDeviceCapabilities,
  type DeviceCapabilitySnapshot,
  type LocationSample,
  type NotificationState,
  type PermissionState
} from "@cop/cop-device-contract";
import { MethodCopDeviceAdapter } from "./base";
import { CopDeviceError, unsupported } from "./error";
import type { PermissionName } from "./types";

export interface BrowserCopDeviceEnvironment {
  geolocation?: Geolocation;
  permissions?: Permissions;
  notification?: typeof Notification;
  online?: () => boolean;
  addConnectivityListener?: (listener: () => void) => () => void;
  now?: () => Date;
  randomUUID?: () => string;
  foreground?: () => boolean;
}

const browserLimits = {
  maxAssetBytes: 0,
  maxJsonBytes: 65_536,
  requestTimeoutMs: 15_000
};

export class BrowserCopDeviceAdapter extends MethodCopDeviceAdapter {
  readonly adapterKind = "browser" as const;
  private readonly environment: Required<
    Pick<BrowserCopDeviceEnvironment, "now" | "randomUUID" | "online" | "foreground">
  > &
    BrowserCopDeviceEnvironment;
  private readonly locationWatches = new Map<string, number>();
  private readonly connectivityWatches = new Map<string, () => void>();

  constructor(environment: BrowserCopDeviceEnvironment = defaultBrowserEnvironment()) {
    super();
    this.environment = {
      ...environment,
      now: environment.now ?? (() => new Date()),
      randomUUID: environment.randomUUID ?? defaultRandomUUID,
      online: environment.online ?? (() => true),
      foreground: environment.foreground ?? (() => true)
    };
  }

  protected async invoke<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    switch (method) {
      case "system.getCapabilities":
        return (await this.capabilitySnapshot()) as Result;
      case "system.getAppInfo":
        return { appVersion: "web", host: "browser", platform: "web" } as Result;
      case "system.getDeviceState":
        return { foreground: this.environment.foreground(), observedAt: this.nowIso() } as Result;
      case "permissions.getStatus":
        return (await this.permissionStatus(params.permission as PermissionName)) as Result;
      case "permissions.request":
        return (await this.requestPermission(params.permission as PermissionName)) as Result;
      case "location.getCurrent":
        return (await this.getCurrentLocation(params)) as Result;
      case "location.startUpdates":
        return this.startLocationUpdates(params) as Result;
      case "location.stopUpdates":
        this.stopLocationUpdates(String(params.subscriptionId));
        return undefined as Result;
      case "connectivity.getState":
        return this.connectivityState() as Result;
      case "connectivity.startMonitoring":
        return this.startConnectivityMonitoring() as Result;
      case "connectivity.stopMonitoring":
        this.stopConnectivityMonitoring(String(params.subscriptionId));
        return undefined as Result;
      case "notifications.getStatus":
        return this.notificationState() as Result;
      case "notifications.requestAuthorization":
        return (await this.requestNotificationAuthorization()) as Result;
      case "relay.getStatus":
        return { state: "disabled", observedAt: this.nowIso() } as Result;
      default:
        throw unsupported(method);
    }
  }

  private async capabilitySnapshot(): Promise<DeviceCapabilitySnapshot> {
    const supported = (permission: PermissionState = "granted"): CapabilityDescriptor => ({
      availability: "supported",
      permission,
      supportsBackground: false
    });
    const unavailable = (limitation: string): CapabilityDescriptor => ({
      availability: "unsupported",
      permission: "unavailable",
      supportsBackground: false,
      limitations: [limitation]
    });
    const capabilities: CopDeviceCapabilities = {
      system: supported(),
      permissions: supported(),
      location: this.environment.geolocation
        ? supported(await this.permissionStatus("location"))
        : unavailable("Geolocation API is unavailable."),
      heading: unavailable("Reliable heading is available only through a native host."),
      attitude: unavailable("Reliable device attitude is available only through a native host."),
      tracking: unavailable("Durable background tracking is available only through a native host."),
      connectivity: supported(),
      media: unavailable("Native opaque asset handles are unavailable in a browser."),
      shares: unavailable("The native share inbox is unavailable in a browser."),
      notifications: this.environment.notification
        ? supported(notificationPermission(this.environment.notification.permission))
        : unavailable("Notification API is unavailable."),
      relay: unavailable("Device relay is disabled in the browser adapter.")
    };
    return {
      adapter: "browser",
      capabilities,
      limits: browserLimits,
      observedAt: this.nowIso(),
      protocolVersion: COP_DEVICE_PROTOCOL_VERSION
    };
  }

  private async permissionStatus(permission: PermissionName): Promise<PermissionState> {
    if (permission === "notifications") {
      return this.environment.notification
        ? notificationPermission(this.environment.notification.permission)
        : "unavailable";
    }
    if (permission !== "location" || !this.environment.geolocation) {
      return "unavailable";
    }
    if (!this.environment.permissions) {
      return "notDetermined";
    }
    try {
      const result = await this.environment.permissions.query({ name: "geolocation" });
      return browserPermission(result.state);
    } catch {
      return "notDetermined";
    }
  }

  private async requestPermission(permission: PermissionName): Promise<PermissionState> {
    if (permission === "notifications") {
      return (await this.requestNotificationAuthorization()).authorization;
    }
    if (permission === "location") {
      await this.getCurrentLocation({ timeoutMs: 15_000 });
      return "granted";
    }
    throw unsupported(`permissions.request(${permission})`);
  }

  private getCurrentLocation(params: Record<string, unknown>): Promise<LocationSample> {
    const geolocation = this.environment.geolocation;
    if (!geolocation) {
      return Promise.reject(unsupported("location.getCurrent"));
    }
    return new Promise((resolve, reject) => {
      geolocation.getCurrentPosition(
        (position) => resolve(this.locationSample(position)),
        (error) => reject(geolocationError(error)),
        {
          enableHighAccuracy: params.desiredAccuracy === "best",
          maximumAge: finiteNumber(params.maximumAgeMs, 0),
          timeout: finiteNumber(params.timeoutMs, 15_000)
        }
      );
    });
  }

  private startLocationUpdates(params: Record<string, unknown>): { subscriptionId: string } {
    const geolocation = this.environment.geolocation;
    if (!geolocation?.watchPosition) {
      throw unsupported("location.startUpdates");
    }
    const subscriptionId = this.environment.randomUUID();
    const watchId = geolocation.watchPosition(
      (position) =>
        this.emit({ type: "location.updated", occurredAt: this.nowIso(), payload: this.locationSample(position) }),
      (error) =>
        this.emit({
          type: "location.error",
          occurredAt: this.nowIso(),
          payload: errorPayload(geolocationError(error))
        }),
      { enableHighAccuracy: params.desiredAccuracy === "best", maximumAge: 5_000, timeout: 20_000 }
    );
    this.locationWatches.set(subscriptionId, watchId);
    return { subscriptionId };
  }

  private stopLocationUpdates(subscriptionId: string): void {
    const watchId = this.locationWatches.get(subscriptionId);
    if (watchId === undefined) {
      return;
    }
    this.locationWatches.delete(subscriptionId);
    this.environment.geolocation?.clearWatch(watchId);
  }

  private locationSample(position: GeolocationPosition): LocationSample {
    const now = this.nowIso();
    return {
      sampleId: this.environment.randomUUID(),
      measuredAt: new Date(position.timestamp).toISOString(),
      receivedAt: now,
      source: this.environment.now().getTime() - position.timestamp > 1_000 ? "cached" : "live",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      horizontalAccuracyM: position.coords.accuracy,
      altitudeM: position.coords.altitude,
      verticalAccuracyM: position.coords.altitudeAccuracy,
      speedMps: position.coords.speed,
      courseDeg: position.coords.heading,
      reducedAccuracy: false,
      valid: Number.isFinite(position.coords.latitude) && Number.isFinite(position.coords.longitude)
    };
  }

  private connectivityState(): ConnectivityState {
    return {
      status: this.environment.online() ? "online" : "offline",
      copReachability: "unknown",
      observedAt: this.nowIso()
    };
  }

  private startConnectivityMonitoring(): { subscriptionId: string } {
    const subscriptionId = this.environment.randomUUID();
    const remove = this.environment.addConnectivityListener?.(() => {
      this.emit({ type: "connectivity.changed", occurredAt: this.nowIso(), payload: this.connectivityState() });
    });
    this.connectivityWatches.set(subscriptionId, remove ?? (() => undefined));
    return { subscriptionId };
  }

  private stopConnectivityMonitoring(subscriptionId: string): void {
    this.connectivityWatches.get(subscriptionId)?.();
    this.connectivityWatches.delete(subscriptionId);
  }

  private notificationState(): NotificationState {
    const authorization = this.environment.notification
      ? notificationPermission(this.environment.notification.permission)
      : "unavailable";
    const granted = authorization === "granted";
    return {
      authorization,
      alertsEnabled: granted,
      soundsEnabled: granted,
      badgesEnabled: false,
      timeSensitiveEnabled: false,
      criticalAlertsEnabled: false,
      remoteRegistration: "unavailable",
      observedAt: this.nowIso()
    };
  }

  private async requestNotificationAuthorization(): Promise<NotificationState> {
    const notification = this.environment.notification;
    if (!notification) {
      throw unsupported("notifications.requestAuthorization");
    }
    await notification.requestPermission();
    return this.notificationState();
  }

  private nowIso(): string {
    return this.environment.now().toISOString();
  }
}

export function defaultBrowserEnvironment(): BrowserCopDeviceEnvironment {
  const globalNavigator = typeof navigator === "undefined" ? undefined : navigator;
  const globalWindow = typeof window === "undefined" ? undefined : window;
  return {
    geolocation: globalNavigator?.geolocation,
    permissions: globalNavigator?.permissions,
    notification: typeof Notification === "undefined" ? undefined : Notification,
    online: () => globalNavigator?.onLine ?? true,
    foreground: () => typeof document === "undefined" || document.visibilityState === "visible",
    addConnectivityListener: globalWindow
      ? (listener) => {
          globalWindow.addEventListener("online", listener);
          globalWindow.addEventListener("offline", listener);
          return () => {
            globalWindow.removeEventListener("online", listener);
            globalWindow.removeEventListener("offline", listener);
          };
        }
      : undefined
  };
}

function notificationPermission(permission: NotificationPermission): PermissionState {
  return permission === "granted" ? "granted" : permission === "denied" ? "denied" : "notDetermined";
}

function browserPermission(permission: PermissionState | "prompt"): PermissionState {
  return permission === "prompt" ? "notDetermined" : permission;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function geolocationError(error: GeolocationPositionError): CopDeviceError {
  if (error.code === error.PERMISSION_DENIED) {
    return new CopDeviceError({
      code: "PERMISSION_DENIED",
      message: error.message || "Location permission was denied.",
      retryable: false
    });
  }
  if (error.code === error.TIMEOUT) {
    return new CopDeviceError({
      code: "TIMEOUT",
      message: error.message || "Location request timed out.",
      retryable: true
    });
  }
  return new CopDeviceError({
    code: "NOT_READY",
    message: error.message || "Location is unavailable.",
    retryable: true
  });
}

function errorPayload(error: CopDeviceError): Record<string, unknown> {
  return { code: error.code, message: error.message, retryable: error.retryable };
}

function defaultRandomUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
