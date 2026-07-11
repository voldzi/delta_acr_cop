import {
  COP_DEVICE_PROTOCOL_VERSION,
  COP_DEVICE_SUPPORTED_VERSIONS,
  type BridgeBlocked,
  type BridgeEvent,
  type BridgeHello,
  type BridgeInboundMessage,
  type BridgeOutboundMessage,
  type BridgeReady,
  type BridgeRequest,
  type BridgeResponse,
  type DeviceCapabilitySnapshot
} from "@cop/cop-device-contract";
import { MethodCopDeviceAdapter } from "./base";
import { CopDeviceError } from "./error";

export interface NativeBridgeTransport {
  postMessage(message: BridgeOutboundMessage): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface NativeCopDeviceOptions {
  webBuildId?: string;
  handshakeTimeoutMs?: number;
  randomUUID?: () => string;
  now?: () => Date;
}

interface PendingRequest {
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NativeCopDeviceAdapter extends MethodCopDeviceAdapter {
  readonly adapterKind = "native" as const;
  private readonly now: () => Date;
  private readonly randomUUID: () => string;
  private readonly transport: NativeBridgeTransport;
  private readonly removeTransportListener: () => void;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly helloId: string;
  private readonly readyPromise: Promise<BridgeReady>;
  private resolveReady!: (ready: BridgeReady) => void;
  private rejectReady!: (error: unknown) => void;
  private handshakeTimer: ReturnType<typeof setTimeout>;
  private readyMessage?: BridgeReady;
  private lastEventSequence = -1;
  private disposed = false;

  constructor(transport: NativeBridgeTransport, options: NativeCopDeviceOptions = {}) {
    super();
    this.transport = transport;
    this.now = options.now ?? (() => new Date());
    this.randomUUID = options.randomUUID ?? defaultRandomUUID;
    this.helloId = this.randomUUID();
    this.readyPromise = new Promise<BridgeReady>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.removeTransportListener = transport.subscribe((message) => this.handleMessage(message));
    this.handshakeTimer = setTimeout(
      () =>
        this.rejectHandshake(
          new CopDeviceError({ code: "TIMEOUT", message: "Native bridge handshake timed out.", retryable: true })
        ),
      options.handshakeTimeoutMs ?? 5_000
    );
    const hello: BridgeHello = {
      kind: "hello",
      id: this.helloId,
      sentAt: this.now().toISOString(),
      supportedVersions: [...COP_DEVICE_SUPPORTED_VERSIONS],
      webBuildId: options.webBuildId ?? "cop-web"
    };
    this.transport.postMessage(hello);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.handshakeTimer);
    this.removeTransportListener();
    const error = new CopDeviceError({
      code: "CANCELLED",
      message: "Native bridge adapter was disposed.",
      retryable: false
    });
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.rejectReady(error);
  }

  protected async invoke<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    const ready = await this.readyPromise;
    if (method === "system.getCapabilities") {
      return {
        adapter: "native",
        capabilities: ready.capabilities,
        limits: ready.limits,
        observedAt: ready.sentAt,
        protocolVersion: ready.selectedVersion
      } satisfies DeviceCapabilitySnapshot as Result;
    }
    if (this.disposed) {
      throw new CopDeviceError({
        code: "TRANSPORT_UNAVAILABLE",
        message: "Native bridge transport is closed.",
        retryable: true
      });
    }
    const id = this.randomUUID();
    const request: BridgeRequest = {
      kind: "request",
      protocolVersion: COP_DEVICE_PROTOCOL_VERSION,
      id,
      sessionId: ready.sessionId,
      method,
      sentAt: this.now().toISOString(),
      params
    };
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength > ready.limits.maxJsonBytes) {
      throw new CopDeviceError({
        code: "PAYLOAD_TOO_LARGE",
        message: "Native bridge request exceeds the negotiated JSON limit.",
        retryable: false
      });
    }
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CopDeviceError({ code: "TIMEOUT", message: `${method} timed out.`, retryable: true }));
      }, ready.limits.requestTimeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as Result), reject, timer });
      try {
        this.transport.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private handleMessage(value: unknown): void {
    if (!isInboundMessage(value)) return;
    if (value.kind === "ready" || value.kind === "blocked") {
      this.handleHandshake(value);
      return;
    }
    if (!this.readyMessage || value.sessionId !== this.readyMessage.sessionId) return;
    if (value.kind === "response") {
      this.handleResponse(value);
      return;
    }
    this.handleEvent(value);
  }

  private handleHandshake(message: BridgeReady | BridgeBlocked): void {
    if (message.id !== this.helloId || this.readyMessage) return;
    clearTimeout(this.handshakeTimer);
    if (message.kind === "blocked") {
      this.rejectHandshake(new CopDeviceError(message.error));
      return;
    }
    if (message.selectedVersion !== COP_DEVICE_PROTOCOL_VERSION) {
      this.rejectHandshake(
        new CopDeviceError({
          code: "PROTOCOL_VERSION_UNSUPPORTED",
          message: `Native selected unsupported protocol ${message.selectedVersion}.`,
          retryable: false
        })
      );
      return;
    }
    this.readyMessage = message;
    this.resolveReady(message);
    this.emit({
      type: "device.ready",
      occurredAt: message.sentAt,
      payload: { protocolVersion: message.selectedVersion }
    });
  }

  private rejectHandshake(error: unknown): void {
    clearTimeout(this.handshakeTimer);
    this.rejectReady(error);
  }

  private handleResponse(response: BridgeResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new CopDeviceError(response.error));
  }

  private handleEvent(event: BridgeEvent): void {
    if (event.sequence <= this.lastEventSequence) return;
    this.lastEventSequence = event.sequence;
    this.emit({ type: event.type, occurredAt: event.occurredAt, payload: event.payload });
  }
}

function isInboundMessage(value: unknown): value is BridgeInboundMessage {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "ready" || kind === "blocked" || kind === "response" || kind === "event";
}

function defaultRandomUUID(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
        const random = Math.floor(Math.random() * 16);
        return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
      });
}
