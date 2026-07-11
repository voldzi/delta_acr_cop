type NativeBridgeMessage = Record<string, unknown>;

interface NativeTransport {
  postMessage(message: NativeBridgeMessage): void;
  subscribe(listener: (message: NativeBridgeMessage) => void): () => void;
}

interface NativeWindow extends Window {
  __COP_DEVICE_NATIVE_TRANSPORT__?: NativeTransport;
}

interface PendingRequest {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface NativeHeadingSample {
  accuracyDeg: number;
  calibration: "calibrated" | "uncalibrated" | "unavailable";
  magneticHeadingDeg: number;
  reference: "magneticNorth" | "trueNorth";
  trueHeadingDeg: number | null;
  valid: boolean;
}

export class NativeDeviceBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "NativeDeviceBridgeError";
  }
}

class NativeDeviceClient {
  private readonly eventListeners = new Set<(message: NativeBridgeMessage) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private readyPromise?: Promise<void>;
  private sessionId?: string;

  constructor(private readonly transport: NativeTransport) {
    transport.subscribe((message) => this.receive(message));
  }

  async startHeading(listener: (sample: NativeHeadingSample) => void): Promise<() => void> {
    await this.ready();
    let permission = await this.request("permissions.getStatus", { permission: "location" });
    if (permissionStatus(permission) === "notDetermined") {
      permission = await this.request("permissions.request", { permission: "location" });
    }
    const status = permissionStatus(permission);
    if (status !== "granted") {
      throw new NativeDeviceBridgeError("Přístup k poloze pro buzolu je zamítnutý.", permissionErrorCode(status));
    }

    const eventListener = (message: NativeBridgeMessage) => {
      if (message.type !== "heading.updated" || !isHeadingSample(message.payload)) {
        return;
      }
      listener(message.payload);
    };
    this.eventListeners.add(eventListener);
    try {
      await this.request("heading.startUpdates", {});
    } catch (error) {
      this.eventListeners.delete(eventListener);
      throw error;
    }
    return () => {
      this.eventListeners.delete(eventListener);
      void this.request("heading.stopUpdates", {}).catch(() => undefined);
    };
  }

  async enableRemoteNotifications(apiBase: string, authToken: string): Promise<{ deviceId: string }> {
    await this.ready();
    const context = await this.request("notifications.getRegistrationContext", {});
    if (!isRecord(context) || typeof context.appInstanceId !== "string" || typeof context.bundleId !== "string") {
      throw new NativeDeviceBridgeError("Nativní registrační kontext je neplatný.", "INVALID_STATE");
    }
    const permission = await this.request("notifications.requestAuthorization", {});
    const authorization = isRecord(permission) ? permission.authorization : undefined;
    if (!isGrantedNotificationAuthorization(authorization)) {
      throw new NativeDeviceBridgeError("Oznámení jsou v systému zamítnutá.", "PERMISSION_DENIED");
    }
    const response = await fetch(`${apiBase}/api/v1/mobile/device-registration-tickets`, {
      body: JSON.stringify({ appInstanceId: context.appInstanceId, bundleId: context.bundleId }),
      headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      method: "POST"
    });
    if (!response.ok) {
      throw new NativeDeviceBridgeError("COP nevydal registrační ticket pro oznámení.", "TRANSPORT_UNAVAILABLE");
    }
    const ticket = (await response.json()) as unknown;
    if (!isRecord(ticket) || typeof ticket.ticket !== "string" || typeof ticket.messagingBaseUrl !== "string") {
      throw new NativeDeviceBridgeError("COP vrátil neplatný registrační ticket.", "INVALID_STATE");
    }
    const registration = await this.request("notifications.registerRemote", {
      messagingBaseUrl: ticket.messagingBaseUrl,
      ticket: ticket.ticket
    });
    if (!isRecord(registration) || registration.registered !== true || typeof registration.deviceId !== "string") {
      throw new NativeDeviceBridgeError("CSM Messaging registraci nepotvrdil.", "TRANSPORT_UNAVAILABLE");
    }
    return { deviceId: registration.deviceId };
  }

  private ready(): Promise<void> {
    if (this.sessionId) {
      return Promise.resolve();
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.readyPromise = undefined;
        reject(new NativeDeviceBridgeError("Nativní bridge neodpověděl včas.", "TIMEOUT"));
      }, 15_000);
      this.pending.set(id, {
        reject,
        resolve: (message) => {
          const ready = message as NativeBridgeMessage;
          if (ready.kind !== "ready" || typeof ready.sessionId !== "string") {
            reject(new NativeDeviceBridgeError("Nativní bridge odmítl handshake.", "NOT_READY"));
            return;
          }
          this.sessionId = ready.sessionId;
          resolve();
        },
        timeout
      });
      this.transport.postMessage({
        id,
        kind: "hello",
        sentAt: new Date().toISOString(),
        supportedVersions: ["1.0.0"],
        webBuildId: "cop-web"
      });
    });
    return this.readyPromise;
  }

  private async request(method: string, params: NativeBridgeMessage): Promise<unknown> {
    await this.ready();
    const sessionId = this.sessionId;
    if (!sessionId) {
      throw new NativeDeviceBridgeError("Nativní bridge nemá aktivní session.", "SESSION_EXPIRED");
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new NativeDeviceBridgeError("Nativní operace neodpověděla včas.", "TIMEOUT"));
      }, 15_000);
      this.pending.set(id, { reject, resolve, timeout });
      this.transport.postMessage({
        id,
        kind: "request",
        method,
        params,
        protocolVersion: "1.0.0",
        sentAt: new Date().toISOString(),
        sessionId
      });
    });
  }

  private receive(message: NativeBridgeMessage): void {
    if (message.kind === "event") {
      for (const listener of this.eventListeners) {
        listener(message);
      }
      return;
    }
    const id = typeof message.id === "string" ? message.id : undefined;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (message.kind === "blocked" || message.ok === false) {
      const error = isRecord(message.error) ? message.error : {};
      pending.reject(
        new NativeDeviceBridgeError(
          typeof error.message === "string" ? error.message : "Nativní operace selhala.",
          typeof error.code === "string" ? error.code : "INTERNAL"
        )
      );
      return;
    }
    pending.resolve(message.kind === "ready" ? message : message.result);
  }
}

let client: NativeDeviceClient | undefined;

export function nativeCompassAvailable(): boolean {
  return typeof window !== "undefined" && Boolean((window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__);
}

export async function startNativeHeading(listener: (sample: NativeHeadingSample) => void): Promise<() => void> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) {
    throw new NativeDeviceBridgeError("Nativní bridge není dostupný.", "UNSUPPORTED");
  }
  client ??= new NativeDeviceClient(transport);
  return client.startHeading(listener);
}

export async function enableNativeRemoteNotifications(
  apiBase: string,
  authToken: string
): Promise<{ deviceId: string }> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) throw new NativeDeviceBridgeError("Nativní bridge není dostupný.", "UNSUPPORTED");
  client ??= new NativeDeviceClient(transport);
  return client.enableRemoteNotifications(apiBase, authToken);
}

function permissionStatus(value: unknown): string {
  return isRecord(value) && typeof value.status === "string" ? value.status : "unavailable";
}

function permissionErrorCode(status: string): string {
  if (status === "restricted") return "PERMISSION_RESTRICTED";
  if (status === "notDetermined") return "PERMISSION_NOT_DETERMINED";
  return "PERMISSION_DENIED";
}

function isHeadingSample(value: unknown): value is NativeHeadingSample {
  return (
    isRecord(value) &&
    typeof value.magneticHeadingDeg === "number" &&
    (typeof value.trueHeadingDeg === "number" || value.trueHeadingDeg === null) &&
    typeof value.accuracyDeg === "number" &&
    typeof value.valid === "boolean" &&
    (value.reference === "magneticNorth" || value.reference === "trueNorth") &&
    (value.calibration === "calibrated" || value.calibration === "uncalibrated" || value.calibration === "unavailable")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGrantedNotificationAuthorization(value: unknown): boolean {
  return value === "authorized" || value === "provisional" || value === "ephemeral";
}
