import type { CopDevice } from "./types";
import type { CopDeviceEvent, CopDeviceAdapterKind, PermissionName } from "./types";

export abstract class MethodCopDeviceAdapter implements CopDevice {
  abstract readonly adapterKind: CopDeviceAdapterKind;
  private readonly listeners = new Set<(event: CopDeviceEvent) => void>();

  readonly system = {
    getCapabilities: () => this.invoke("system.getCapabilities"),
    getAppInfo: () => this.invoke("system.getAppInfo"),
    getDeviceState: () => this.invoke("system.getDeviceState")
  } satisfies CopDevice["system"];

  readonly permissions = {
    getStatus: (permission: PermissionName) => this.invoke("permissions.getStatus", { permission }),
    request: (permission: PermissionName) => this.invoke("permissions.request", { permission }),
    openSettings: () => this.invoke("permissions.openSettings")
  } satisfies CopDevice["permissions"];

  readonly location = {
    getCurrent: (options = {}) => this.invoke("location.getCurrent", options),
    startUpdates: (options = {}) => this.invoke("location.startUpdates", options),
    stopUpdates: (subscriptionId: string) => this.invoke("location.stopUpdates", { subscriptionId })
  } satisfies CopDevice["location"];

  readonly heading = {
    startUpdates: (options = {}) => this.invoke("heading.startUpdates", options),
    stopUpdates: (subscriptionId: string) => this.invoke("heading.stopUpdates", { subscriptionId })
  } satisfies CopDevice["heading"];

  readonly attitude = {
    startUpdates: (options = {}) => this.invoke("attitude.startUpdates", options),
    stopUpdates: (subscriptionId: string) => this.invoke("attitude.stopUpdates", { subscriptionId })
  } satisfies CopDevice["attitude"];

  readonly tracking = {
    startSession: (options = {}) => this.invoke("tracking.startSession", options),
    getSession: (sessionId?: string) => this.invoke("tracking.getSession", sessionId ? { sessionId } : {}),
    readSamples: (sessionId: string, options = {}) => this.invoke("tracking.readSamples", { sessionId, ...options }),
    stopSession: (sessionId: string) => this.invoke("tracking.stopSession", { sessionId })
  } satisfies CopDevice["tracking"];

  readonly connectivity = {
    getState: () => this.invoke("connectivity.getState"),
    startMonitoring: () => this.invoke("connectivity.startMonitoring"),
    stopMonitoring: (subscriptionId: string) => this.invoke("connectivity.stopMonitoring", { subscriptionId })
  } satisfies CopDevice["connectivity"];

  readonly media = {
    capturePhoto: (options = {}) => this.invoke("media.capturePhoto", options),
    pickPhoto: (options = {}) => this.invoke("media.pickPhoto", options),
    pickDocument: (options = {}) => this.invoke("media.pickDocument", options),
    getAssetMetadata: (assetId: string) => this.invoke("media.getAssetMetadata", { assetId }),
    releaseAsset: (assetId: string) => this.invoke("media.releaseAsset", { assetId })
  } satisfies CopDevice["media"];

  readonly shares = {
    list: () => this.invoke("shares.list"),
    claim: (shareId: string) => this.invoke("shares.claim", { shareId }),
    discard: (shareId: string) => this.invoke("shares.discard", { shareId })
  } satisfies CopDevice["shares"];

  readonly notifications = {
    getStatus: () => this.invoke("notifications.getStatus"),
    requestAuthorization: (options = {}) => this.invoke("notifications.requestAuthorization", options),
    scheduleLocal: (request) => this.invoke("notifications.scheduleLocal", request),
    cancelLocal: (notificationId: string) => this.invoke("notifications.cancelLocal", { notificationId }),
    registerRemote: (registrationTicket: string) => this.invoke("notifications.registerRemote", { registrationTicket })
  } satisfies CopDevice["notifications"];

  readonly relay = {
    getStatus: () => this.invoke("relay.getStatus"),
    start: () => this.invoke("relay.start"),
    stop: () => this.invoke("relay.stop"),
    enqueue: (envelope: Record<string, unknown>) => this.invoke("relay.enqueue", { envelope }),
    listQueue: () => this.invoke("relay.listQueue")
  } satisfies CopDevice["relay"];

  readonly events = {
    subscribe: (listener: (event: CopDeviceEvent) => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  };

  protected emit(event: CopDeviceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  protected abstract invoke<Result>(method: string, params?: Record<string, unknown>): Promise<Result>;
}
