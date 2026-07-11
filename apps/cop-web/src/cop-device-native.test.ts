// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { nativeCompassAvailable, startNativeHeading } from "./cop-device-native";

describe("native COP device heading adapter", () => {
  it("handshakes, checks permission and forwards native heading events", async () => {
    const listeners = new Set<(message: Record<string, unknown>) => void>();
    const methods: string[] = [];
    const transport = {
      postMessage(message: Record<string, unknown>) {
        if (message.kind === "hello") {
          listeners.forEach((listener) =>
            listener({ id: message.id, kind: "ready", sessionId: "20000000-0000-4000-8000-000000000001" })
          );
          return;
        }
        methods.push(String(message.method));
        listeners.forEach((listener) =>
          listener({
            id: message.id,
            kind: "response",
            ok: true,
            result: message.method === "permissions.getStatus" ? { status: "granted" } : { started: true }
          })
        );
      },
      subscribe(listener: (message: Record<string, unknown>) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
    Object.defineProperty(window, "__COP_DEVICE_NATIVE_TRANSPORT__", { configurable: true, value: transport });
    const heading = vi.fn();

    const stop = await startNativeHeading(heading);
    listeners.forEach((listener) =>
      listener({
        kind: "event",
        payload: {
          accuracyDeg: 4,
          calibration: "calibrated",
          magneticHeadingDeg: 181,
          reference: "trueNorth",
          trueHeadingDeg: 184,
          valid: true
        },
        type: "heading.updated"
      })
    );

    expect(nativeCompassAvailable()).toBe(true);
    expect(methods).toEqual(["permissions.getStatus", "heading.startUpdates"]);
    expect(heading).toHaveBeenCalledWith(expect.objectContaining({ trueHeadingDeg: 184 }));
    stop();
  });
});
