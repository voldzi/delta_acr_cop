import {
  COP_DEVICE_PROTOCOL_VERSION,
  copDeviceCapabilityNames,
  type CapabilityDescriptor,
  type CopDeviceCapabilities,
  type CopDeviceErrorPayload,
  type DeviceCapabilitySnapshot
} from "@cop/cop-device-contract";
import { MethodCopDeviceAdapter } from "./base";
import { CopDeviceError, unsupported } from "./error";
import type { CopDeviceEvent } from "./types";

export interface MockCopDeviceOptions {
  capabilities?: Partial<CopDeviceCapabilities>;
  handlers?: Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>;
  now?: () => Date;
  limits?: Partial<DeviceCapabilitySnapshot["limits"]>;
}

export class MockCopDeviceAdapter extends MethodCopDeviceAdapter {
  readonly adapterKind = "mock" as const;
  private readonly handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  private readonly failures = new Map<string, CopDeviceErrorPayload>();
  private readonly now: () => Date;
  private readonly snapshot: DeviceCapabilitySnapshot;

  constructor(options: MockCopDeviceOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date("2026-01-01T00:00:00.000Z"));
    this.snapshot = {
      adapter: "mock",
      protocolVersion: COP_DEVICE_PROTOCOL_VERSION,
      observedAt: this.now().toISOString(),
      limits: { maxAssetBytes: 0, maxJsonBytes: 65_536, requestTimeoutMs: 15_000, ...options.limits },
      capabilities: { ...defaultMockCapabilities(), ...options.capabilities }
    };
    for (const [method, handler] of Object.entries(options.handlers ?? {})) {
      this.handlers.set(method, handler);
    }
  }

  setHandler<Result>(method: string, handler: (params: Record<string, unknown>) => Result | Promise<Result>): void {
    this.handlers.set(method, handler);
  }

  failNext(method: string, error: CopDeviceErrorPayload): void {
    this.failures.set(method, error);
  }

  setCapability(name: keyof CopDeviceCapabilities, descriptor: CapabilityDescriptor): void {
    this.snapshot.capabilities[name] = descriptor;
    this.snapshot.observedAt = this.now().toISOString();
    this.emitEvent({
      type: "device.capabilities.changed",
      occurredAt: this.snapshot.observedAt,
      payload: this.snapshot
    });
  }

  emitEvent(event: CopDeviceEvent): void {
    this.emit(event);
  }

  protected async invoke<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    if (method === "system.getCapabilities") return structuredClone(this.snapshot) as Result;
    if (method === "system.getAppInfo") return { appVersion: "1.0.0-test", host: "mock", platform: "test" } as Result;
    if (method === "system.getDeviceState") return { foreground: true, observedAt: this.now().toISOString() } as Result;
    if (method === "connectivity.getState") {
      return { status: "online", copReachability: "unknown", observedAt: this.now().toISOString() } as Result;
    }
    if (method === "notifications.getStatus") {
      return {
        authorization: this.snapshot.capabilities.notifications.permission,
        alertsEnabled: false,
        soundsEnabled: false,
        badgesEnabled: false,
        timeSensitiveEnabled: false,
        criticalAlertsEnabled: false,
        remoteRegistration: "unavailable",
        observedAt: this.now().toISOString()
      } as Result;
    }
    if (method === "relay.getStatus") return { state: "disabled", observedAt: this.now().toISOString() } as Result;
    if (method === "permissions.getStatus" || method === "permissions.request") {
      return this.permissionFor(String(params.permission)) as Result;
    }
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw new CopDeviceError(failure);
    }
    const handler = this.handlers.get(method);
    if (!handler) throw unsupported(method);
    return (await handler(params)) as Result;
  }

  private permissionFor(permission: string): CopDeviceCapabilities[keyof CopDeviceCapabilities]["permission"] {
    if (permission === "motion") return this.snapshot.capabilities.attitude.permission;
    if (permission === "camera" || permission === "photos") return this.snapshot.capabilities.media.permission;
    if (permission === "bluetooth" || permission === "localNetwork") return this.snapshot.capabilities.relay.permission;
    if (permission === "location" || permission === "notifications") {
      return this.snapshot.capabilities[permission].permission;
    }
    return "unavailable";
  }
}

export function defaultMockCapabilities(): CopDeviceCapabilities {
  const unavailable: CapabilityDescriptor = {
    availability: "unsupported",
    permission: "unavailable",
    supportsBackground: false
  };
  const capabilities = Object.fromEntries(
    copDeviceCapabilityNames.map((name) => [name, { ...unavailable }])
  ) as unknown as CopDeviceCapabilities;
  capabilities.system = { availability: "supported", permission: "granted", supportsBackground: false };
  capabilities.permissions = { availability: "supported", permission: "granted", supportsBackground: false };
  capabilities.connectivity = { availability: "supported", permission: "granted", supportsBackground: false };
  return capabilities;
}

export const mockCapabilityScenarios = {
  denied: (): CapabilityDescriptor => ({ availability: "supported", permission: "denied", supportsBackground: false }),
  unsupported: (): CapabilityDescriptor => ({
    availability: "unsupported",
    permission: "unavailable",
    supportsBackground: false
  }),
  degraded: (reason = "Temporarily unavailable."): CapabilityDescriptor => ({
    availability: "temporarilyUnavailable",
    permission: "granted",
    supportsBackground: false,
    limitations: [reason]
  })
};
