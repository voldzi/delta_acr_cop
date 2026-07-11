import { BrowserCopDeviceAdapter, type BrowserCopDeviceEnvironment } from "./browser";
import { MockCopDeviceAdapter } from "./mock";
import { NativeCopDeviceAdapter, type NativeBridgeTransport, type NativeCopDeviceOptions } from "./native";
import type { CopDevice } from "./types";

export interface CreateCopDeviceOptions {
  browserEnvironment?: BrowserCopDeviceEnvironment;
  nativeTransport?: NativeBridgeTransport;
  native?: NativeCopDeviceOptions;
}

export function createCopDevice(options: CreateCopDeviceOptions = {}): CopDevice {
  return options.nativeTransport
    ? new NativeCopDeviceAdapter(options.nativeTransport, options.native)
    : new BrowserCopDeviceAdapter(options.browserEnvironment);
}

export { BrowserCopDeviceAdapter } from "./browser";
export { CopDeviceError } from "./error";
export { MockCopDeviceAdapter, defaultMockCapabilities, mockCapabilityScenarios } from "./mock";
export { NativeCopDeviceAdapter } from "./native";
export type { BrowserCopDeviceEnvironment } from "./browser";
export type { NativeBridgeTransport, NativeCopDeviceOptions } from "./native";
export type {
  CapabilityAvailability,
  CopDevice,
  CopDeviceAdapterKind,
  CopDeviceEvent,
  DeviceCapabilitySnapshot,
  PermissionName,
  Unsubscribe
} from "./types";
