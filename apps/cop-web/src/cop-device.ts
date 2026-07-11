import { createCopDevice, type CopDevice, type NativeBridgeTransport } from "@cop/cop-device-sdk";

declare global {
  interface Window {
    __COP_DEVICE_NATIVE_TRANSPORT__?: NativeBridgeTransport;
  }
}

let sharedDevice: CopDevice | undefined;

export function getCopDevice(): CopDevice {
  if (!sharedDevice) {
    const nativeTransport =
      typeof window !== "undefined" && isNativeBridgeTransport(window.__COP_DEVICE_NATIVE_TRANSPORT__)
        ? window.__COP_DEVICE_NATIVE_TRANSPORT__
        : undefined;
    sharedDevice = createCopDevice({
      ...(nativeTransport ? { nativeTransport } : {}),
      native: { webBuildId: import.meta.env.VITE_COP_BUILD_ID ?? "cop-web" }
    });
  }
  return sharedDevice;
}

function isNativeBridgeTransport(value: unknown): value is NativeBridgeTransport {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as NativeBridgeTransport).postMessage === "function" &&
    typeof (value as NativeBridgeTransport).subscribe === "function"
  );
}
