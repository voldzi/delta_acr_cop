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

export interface NativeCallAction {
  action: "addParticipants" | "answer" | "hangup" | "mute" | "reject" | "start";
  actionId: string;
  callId: string;
  kind?: "direct" | "group";
  muted?: boolean;
  participantUserIds?: string[];
  roomId: string;
}

export interface NativeCallActionAcknowledgement {
  actionId: string;
  callId: string;
  roomId: string;
  status: "failed" | "succeeded";
}

export interface NativeCallPresentation {
  callId: string;
  direction: "incoming" | "outgoing";
  eligibleParticipants?: Array<{ connected: boolean; displayName: string; userId: string }>;
  kind?: "direct" | "group";
  participants?: Array<{ connected: boolean; displayName: string; userId: string }>;
  phase: "connecting" | "connected" | "ended" | "failed" | "ringing";
  roomId: string;
  title?: string;
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
    const permission = await this.request("notifications.requestAuthorization", {});
    const authorization = isRecord(permission) ? permission.authorization : undefined;
    if (!isGrantedNotificationAuthorization(authorization)) {
      throw new NativeDeviceBridgeError("Oznámení jsou v systému zamítnutá.", "PERMISSION_DENIED");
    }
    return this.registerRemoteNotifications(apiBase, authToken);
  }

  async refreshRemoteNotifications(apiBase: string, authToken: string): Promise<{ deviceId: string } | null> {
    await this.ready();
    const status = await this.request("notifications.getStatus", {});
    const authorization = isRecord(status) ? status.authorization : undefined;
    if (!isGrantedNotificationAuthorization(authorization)) return null;
    return this.registerRemoteNotifications(apiBase, authToken);
  }

  private async registerRemoteNotifications(apiBase: string, authToken: string): Promise<{ deviceId: string }> {
    const context = await this.request("notifications.getRegistrationContext", {});
    if (!isRecord(context) || typeof context.appInstanceId !== "string" || typeof context.bundleId !== "string") {
      throw new NativeDeviceBridgeError("Nativní registrační kontext je neplatný.", "INVALID_STATE");
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

  async subscribeCallActions(listener: (action: NativeCallAction) => void): Promise<() => void> {
    const eventListener = (message: NativeBridgeMessage) => {
      const action = nativeCallAction(message);
      if (action) listener(action);
    };
    this.eventListeners.add(eventListener);
    try {
      await this.ready();
    } catch (error) {
      this.eventListeners.delete(eventListener);
      throw error;
    }
    return () => this.eventListeners.delete(eventListener);
  }

  async updateCallPresentation(call: NativeCallPresentation): Promise<void> {
    await this.request("calls.updatePresentation", {
      callId: call.callId,
      direction: call.direction,
      ...(call.eligibleParticipants ? { eligibleParticipants: call.eligibleParticipants } : {}),
      ...(call.kind ? { kind: call.kind } : {}),
      ...(call.participants ? { participants: call.participants } : {}),
      phase: call.phase,
      roomId: call.roomId,
      ...(call.title ? { title: call.title } : {})
    });
  }

  async acknowledgeCallAction(acknowledgement: NativeCallActionAcknowledgement): Promise<boolean> {
    const result = await this.request("calls.acknowledgeAction", {
      actionId: acknowledgement.actionId,
      callId: acknowledgement.callId,
      outcome: acknowledgement.status,
      roomId: acknowledgement.roomId
    });
    return isRecord(result) && result.acknowledged === true;
  }

  async openChat(expectedSubjectId?: string): Promise<void> {
    const subjectId = expectedSubjectId?.trim();
    await this.request("communications.openChat", subjectId ? { subjectId } : {});
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
      const code = typeof error.code === "string" ? error.code : "INTERNAL";
      if (code === "SESSION_EXPIRED") {
        this.sessionId = undefined;
        this.readyPromise = undefined;
        void this.ready().catch(() => undefined);
      }
      pending.reject(
        new NativeDeviceBridgeError(
          typeof error.message === "string" ? error.message : "Nativní operace selhala.",
          code
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

export async function refreshNativeRemoteNotificationRegistration(
  apiBase: string,
  authToken: string
): Promise<{ deviceId: string } | null> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) return null;
  client ??= new NativeDeviceClient(transport);
  return client.refreshRemoteNotifications(apiBase, authToken);
}

export async function subscribeNativeCallActions(listener: (action: NativeCallAction) => void): Promise<() => void> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) throw new NativeDeviceBridgeError("Nativní bridge není dostupný.", "UNSUPPORTED");
  client ??= new NativeDeviceClient(transport);
  return client.subscribeCallActions(listener);
}

export async function updateNativeCallPresentation(call: NativeCallPresentation): Promise<void> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) return;
  client ??= new NativeDeviceClient(transport);
  await client.updateCallPresentation(call);
}

export async function acknowledgeNativeCallAction(acknowledgement: NativeCallActionAcknowledgement): Promise<boolean> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) return false;
  client ??= new NativeDeviceClient(transport);
  return client.acknowledgeCallAction(acknowledgement);
}

export async function presentNativeChat(expectedSubjectId?: string): Promise<void> {
  const transport =
    typeof window === "undefined" ? undefined : (window as NativeWindow).__COP_DEVICE_NATIVE_TRANSPORT__;
  if (!transport) throw new NativeDeviceBridgeError("Nativní bridge není dostupný.", "UNSUPPORTED");
  client ??= new NativeDeviceClient(transport);
  await client.openChat(expectedSubjectId);
}

function nativeCallAction(message: NativeBridgeMessage): NativeCallAction | null {
  if (message.kind !== "event" || !isRecord(message.payload)) return null;
  const type = message.type;
  const action =
    type === "calls.startRequested"
      ? "start"
      : type === "calls.answerRequested"
        ? "answer"
        : type === "calls.rejectRequested"
          ? "reject"
          : type === "calls.addParticipantsRequested"
            ? "addParticipants"
            : type === "calls.endRequested"
              ? "hangup"
              : type === "calls.muteRequested"
                ? "mute"
                : null;
  const callId = message.payload.callId;
  const actionId = message.payload.actionId;
  const roomId = message.payload.roomId;
  if (!action || !isUUIDString(actionId) || typeof callId !== "string" || typeof roomId !== "string") return null;
  if (action === "start") {
    const kind = message.payload.kind === "group" ? "group" : message.payload.kind === "direct" ? "direct" : null;
    return kind ? { action, actionId, callId, kind, roomId } : null;
  }
  if (action === "addParticipants") {
    const participantUserIds = Array.isArray(message.payload.participantUserIds)
      ? message.payload.participantUserIds.filter((value): value is string => typeof value === "string").slice(0, 5)
      : [];
    return participantUserIds.length > 0 ? { action, actionId, callId, participantUserIds, roomId } : null;
  }
  if (action === "mute") {
    return typeof message.payload.muted === "boolean"
      ? { action, actionId, callId, muted: message.payload.muted, roomId }
      : null;
  }
  return { action, actionId, callId, roomId };
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

function isUUIDString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function isGrantedNotificationAuthorization(value: unknown): boolean {
  return value === "authorized" || value === "provisional" || value === "ephemeral";
}
