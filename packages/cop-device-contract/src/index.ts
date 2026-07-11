export const COP_DEVICE_PROTOCOL_VERSION = "1.0.0" as const;
export const COP_DEVICE_SUPPORTED_VERSIONS = [COP_DEVICE_PROTOCOL_VERSION] as const;

export const copDeviceCapabilityNames = [
  "system",
  "permissions",
  "location",
  "heading",
  "attitude",
  "tracking",
  "connectivity",
  "media",
  "shares",
  "notifications",
  "relay"
] as const;

export type CopDeviceCapabilityName = (typeof copDeviceCapabilityNames)[number];
export type CapabilityAvailability =
  "supported" | "unsupported" | "experimental" | "restricted" | "temporarilyUnavailable";
export type PermissionState = "notDetermined" | "denied" | "restricted" | "granted" | "limited" | "unavailable";

export interface CapabilityDescriptor {
  availability: CapabilityAvailability;
  permission: PermissionState;
  supportsBackground: boolean;
  requiresForeground?: boolean;
  limitations?: string[];
}

export type CopDeviceCapabilities = Record<CopDeviceCapabilityName, CapabilityDescriptor>;

export interface BridgeLimits {
  maxAssetBytes: number;
  maxJsonBytes: number;
  requestTimeoutMs: number;
}

export interface DeviceCapabilitySnapshot {
  adapter: "browser" | "native" | "mock";
  capabilities: CopDeviceCapabilities;
  limits: BridgeLimits;
  protocolVersion: typeof COP_DEVICE_PROTOCOL_VERSION;
  observedAt: string;
}

export const copDeviceErrorCodes = [
  "UNSUPPORTED",
  "PERMISSION_NOT_DETERMINED",
  "PERMISSION_DENIED",
  "PERMISSION_RESTRICTED",
  "INVALID_REQUEST",
  "INVALID_STATE",
  "ORIGIN_NOT_ALLOWED",
  "MAIN_FRAME_REQUIRED",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "SESSION_EXPIRED",
  "TIMEOUT",
  "CANCELLED",
  "NOT_FOREGROUND",
  "NOT_READY",
  "TRANSPORT_UNAVAILABLE",
  "PAYLOAD_TOO_LARGE",
  "QUEUE_FULL",
  "ASSET_NOT_FOUND",
  "ASSET_EXPIRED",
  "RATE_LIMITED",
  "INTERNAL"
] as const;

export type CopDeviceErrorCode = (typeof copDeviceErrorCodes)[number];

export interface CopDeviceErrorPayload {
  code: CopDeviceErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, boolean | number | string | null>;
}

export interface BridgeHello {
  kind: "hello";
  id: string;
  sentAt: string;
  supportedVersions: string[];
  webBuildId: string;
}

export interface BridgeReady {
  kind: "ready";
  id: string;
  sentAt: string;
  selectedVersion: typeof COP_DEVICE_PROTOCOL_VERSION;
  sessionId: string;
  capabilities: CopDeviceCapabilities;
  limits: BridgeLimits;
}

export interface BridgeBlocked {
  kind: "blocked";
  id: string;
  sentAt: string;
  error: CopDeviceErrorPayload;
}

export interface BridgeRequest<Params = Record<string, unknown>> {
  kind: "request";
  protocolVersion: typeof COP_DEVICE_PROTOCOL_VERSION;
  id: string;
  sessionId: string;
  method: string;
  sentAt: string;
  params: Params;
}

export type BridgeResponse<Result = unknown> =
  | {
      kind: "response";
      protocolVersion: typeof COP_DEVICE_PROTOCOL_VERSION;
      id: string;
      sessionId: string;
      sentAt: string;
      ok: true;
      result: Result;
    }
  | {
      kind: "response";
      protocolVersion: typeof COP_DEVICE_PROTOCOL_VERSION;
      id: string;
      sessionId: string;
      sentAt: string;
      ok: false;
      error: CopDeviceErrorPayload;
    };

export interface BridgeEvent<Payload = unknown> {
  kind: "event";
  protocolVersion: typeof COP_DEVICE_PROTOCOL_VERSION;
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Payload;
}

export type BridgeInboundMessage = BridgeReady | BridgeBlocked | BridgeResponse | BridgeEvent;
export type BridgeOutboundMessage = BridgeHello | BridgeRequest;

export interface LocationSample {
  sampleId: string;
  measuredAt: string;
  receivedAt: string;
  source: "live" | "cached";
  latitude: number;
  longitude: number;
  horizontalAccuracyM: number;
  altitudeM?: number | null;
  verticalAccuracyM?: number | null;
  speedMps?: number | null;
  courseDeg?: number | null;
  reducedAccuracy: boolean;
  valid: boolean;
}

export interface HeadingSample {
  sampleId: string;
  measuredAt: string;
  receivedAt: string;
  source: "live" | "cached";
  magneticHeadingDeg: number;
  trueHeadingDeg?: number | null;
  accuracyDeg: number;
  reference: "magneticNorth" | "trueNorth";
  calibration: "calibrated" | "uncalibrated" | "unavailable";
  valid: boolean;
}

export interface AttitudeSample {
  sampleId: string;
  measuredAt: string;
  receivedAt: string;
  source: "live" | "cached";
  referenceFrame:
    "xArbitraryZVertical" | "xArbitraryCorrectedZVertical" | "xMagneticNorthZVertical" | "xTrueNorthZVertical";
  quaternion: { x: number; y: number; z: number; w: number };
  rollRad: number;
  pitchRad: number;
  yawRad: number;
  valid: boolean;
}

export interface TrackingSession {
  sessionId: string;
  state: "starting" | "active" | "paused" | "stopping" | "stopped" | "degraded" | "failed";
  startedAt: string;
  updatedAt: string;
  stoppedAt?: string | null;
  supportsBackground: boolean;
  sampleCount: number;
  lastSampleAt?: string | null;
  degradedReason?: string | null;
}

export interface TrackingSamplePage {
  sessionId: string;
  samples: LocationSample[];
  nextCursor?: string | null;
}

export type NativeAssetSource = "camera" | "photoPicker" | "documentPicker" | "shareExtension";

export interface NativeAssetRef {
  assetId: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
  source: NativeAssetSource;
  widthPx?: number;
  heightPx?: number;
}

export interface ShareItem {
  shareId: string;
  receivedAt: string;
  state: "available" | "claimed" | "discarded" | "expired";
  asset: NativeAssetRef;
  sourceApplication?: string | null;
}

export interface NotificationState {
  authorization: PermissionState;
  alertsEnabled: boolean;
  soundsEnabled: boolean;
  badgesEnabled: boolean;
  timeSensitiveEnabled: boolean;
  criticalAlertsEnabled: boolean;
  remoteRegistration: "unavailable" | "notRegistered" | "registered" | "failed";
  observedAt: string;
}

export interface ConnectivityState {
  status: "online" | "offline" | "constrained" | "unknown";
  expensive?: boolean;
  copReachability: "unknown" | "reachable" | "unreachable";
  observedAt: string;
}
