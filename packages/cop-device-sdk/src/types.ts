import type {
  AttitudeSample,
  CapabilityAvailability,
  ConnectivityState,
  DeviceCapabilitySnapshot,
  HeadingSample,
  LocationSample,
  NativeAssetRef,
  NotificationState,
  PermissionState,
  ShareItem,
  TrackingSamplePage,
  TrackingSession
} from "@cop/cop-device-contract";

export type CopDeviceAdapterKind = "browser" | "native" | "mock";
export type PermissionName =
  "location" | "motion" | "camera" | "photos" | "notifications" | "bluetooth" | "localNetwork";
export type Unsubscribe = () => void;

export interface CopDeviceEvent<Payload = unknown> {
  type: string;
  occurredAt: string;
  payload: Payload;
}

export interface CopDevice {
  readonly adapterKind: CopDeviceAdapterKind;
  readonly system: {
    getCapabilities(): Promise<DeviceCapabilitySnapshot>;
    getAppInfo(): Promise<{ appVersion: string; buildNumber?: string; host: CopDeviceAdapterKind; platform: string }>;
    getDeviceState(): Promise<{ foreground: boolean; lowPowerMode?: boolean; observedAt: string }>;
  };
  readonly permissions: {
    getStatus(permission: PermissionName): Promise<PermissionState>;
    request(permission: PermissionName): Promise<PermissionState>;
    openSettings(): Promise<{ opened: boolean }>;
  };
  readonly location: {
    getCurrent(options?: {
      desiredAccuracy?: "balanced" | "best";
      maximumAgeMs?: number;
      timeoutMs?: number;
    }): Promise<LocationSample>;
    startUpdates(options?: {
      desiredAccuracy?: "balanced" | "best";
      distanceFilterM?: number;
    }): Promise<{ subscriptionId: string }>;
    stopUpdates(subscriptionId: string): Promise<void>;
  };
  readonly heading: {
    startUpdates(options?: {
      filterDeg?: number;
      reference?: "magneticNorth" | "trueNorth";
    }): Promise<{ subscriptionId: string }>;
    stopUpdates(subscriptionId: string): Promise<void>;
  };
  readonly attitude: {
    startUpdates(options?: {
      intervalMs?: number;
      referenceFrame?: AttitudeSample["referenceFrame"];
    }): Promise<{ subscriptionId: string }>;
    stopUpdates(subscriptionId: string): Promise<void>;
  };
  readonly tracking: {
    startSession(options?: {
      desiredAccuracy?: "balanced" | "best";
      distanceFilterM?: number;
    }): Promise<TrackingSession>;
    getSession(sessionId?: string): Promise<TrackingSession | null>;
    readSamples(sessionId: string, options?: { cursor?: string; limit?: number }): Promise<TrackingSamplePage>;
    stopSession(sessionId: string): Promise<TrackingSession>;
  };
  readonly connectivity: {
    getState(): Promise<ConnectivityState>;
    startMonitoring(): Promise<{ subscriptionId: string }>;
    stopMonitoring(subscriptionId: string): Promise<void>;
  };
  readonly media: {
    capturePhoto(options?: { quality?: number }): Promise<NativeAssetRef>;
    pickPhoto(options?: { allowsMultiple?: boolean }): Promise<NativeAssetRef[]>;
    pickDocument(options?: { mimeTypes?: string[] }): Promise<NativeAssetRef[]>;
    getAssetMetadata(assetId: string): Promise<NativeAssetRef>;
    releaseAsset(assetId: string): Promise<void>;
  };
  readonly shares: {
    list(): Promise<ShareItem[]>;
    claim(shareId: string): Promise<ShareItem>;
    discard(shareId: string): Promise<void>;
  };
  readonly notifications: {
    getStatus(): Promise<NotificationState>;
    requestAuthorization(options?: {
      alerts?: boolean;
      sounds?: boolean;
      badges?: boolean;
    }): Promise<NotificationState>;
    scheduleLocal(request: {
      notificationId: string;
      title: string;
      body: string;
      fireAt: string;
    }): Promise<{ notificationId: string }>;
    cancelLocal(notificationId: string): Promise<void>;
    registerRemote(registrationTicket: string): Promise<{ registered: boolean }>;
  };
  readonly relay: {
    getStatus(): Promise<{ state: "disabled" | "available" | "active" | "degraded"; observedAt: string }>;
    start(): Promise<void>;
    stop(): Promise<void>;
    enqueue(envelope: Record<string, unknown>): Promise<{ queueId: string }>;
    listQueue(): Promise<Array<{ queueId: string; state: string }>>;
  };
  readonly events: {
    subscribe(listener: (event: CopDeviceEvent) => void): Unsubscribe;
  };
}

export type { CapabilityAvailability, DeviceCapabilitySnapshot, HeadingSample, LocationSample };
