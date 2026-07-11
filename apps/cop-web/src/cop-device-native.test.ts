// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  acknowledgeNativeCallAction,
  nativeCompassAvailable,
  presentNativeChat,
  startNativeHeading,
  subscribeNativeCallActions,
  updateNativeCallPresentation
} from "./cop-device-native";

describe("native COP device heading adapter", () => {
  it("handshakes, checks permission and forwards native heading events", async () => {
    const listeners = new Set<(message: Record<string, unknown>) => void>();
    const methods: string[] = [];
    let expireNextSession = false;
    let handshakeCount = 0;
    const transport = {
      postMessage(message: Record<string, unknown>) {
        if (message.kind === "hello") {
          handshakeCount += 1;
          listeners.forEach((listener) =>
            listener({
              id: message.id,
              kind: "ready",
              sessionId: `20000000-0000-4000-8000-${String(handshakeCount).padStart(12, "0")}`
            })
          );
          return;
        }
        methods.push(String(message.method));
        if (expireNextSession) {
          expireNextSession = false;
          listeners.forEach((listener) =>
            listener({
              error: { code: "SESSION_EXPIRED", message: "expired" },
              id: message.id,
              kind: "response",
              ok: false
            })
          );
          return;
        }
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

    const callAction = vi.fn();
    const stopCalls = await subscribeNativeCallActions(callAction);
    listeners.forEach((listener) =>
      listener({
        kind: "event",
        payload: {
          actionId: "10000000-0000-4000-8000-000000000001",
          callId: "call-1",
          roomId: "!ops:example.cz"
        },
        type: "calls.answerRequested"
      })
    );
    expect(callAction).toHaveBeenCalledWith({
      action: "answer",
      actionId: "10000000-0000-4000-8000-000000000001",
      callId: "call-1",
      roomId: "!ops:example.cz"
    });
    listeners.forEach((listener) =>
      listener({
        kind: "event",
        payload: {
          actionId: "20000000-0000-4000-8000-000000000002",
          callId: "call-1",
          muted: true,
          roomId: "!ops:example.cz"
        },
        type: "calls.muteRequested"
      })
    );
    expect(callAction).toHaveBeenCalledWith({
      action: "mute",
      actionId: "20000000-0000-4000-8000-000000000002",
      callId: "call-1",
      muted: true,
      roomId: "!ops:example.cz"
    });
    listeners.forEach((listener) =>
      listener({
        kind: "event",
        payload: {
          actionId: "30000000-0000-4000-8000-000000000003",
          callId: "call-1",
          participantUserIds: ["@bob:example.cz"],
          roomId: "!ops:example.cz"
        },
        type: "calls.addParticipantsRequested"
      })
    );
    expect(callAction).toHaveBeenCalledWith({
      action: "addParticipants",
      actionId: "30000000-0000-4000-8000-000000000003",
      callId: "call-1",
      participantUserIds: ["@bob:example.cz"],
      roomId: "!ops:example.cz"
    });
    listeners.forEach((listener) =>
      listener({
        kind: "event",
        payload: {
          actionId: "40000000-0000-4000-8000-000000000004",
          callId: "native-call-1",
          kind: "group",
          roomId: "!ops:example.cz"
        },
        type: "calls.startRequested"
      })
    );
    expect(callAction).toHaveBeenCalledWith({
      action: "start",
      actionId: "40000000-0000-4000-8000-000000000004",
      callId: "native-call-1",
      kind: "group",
      roomId: "!ops:example.cz"
    });
    await updateNativeCallPresentation({
      callId: "call-1",
      direction: "incoming",
      eligibleParticipants: [{ connected: false, displayName: "Bob", userId: "@bob:example.cz" }],
      kind: "group",
      participants: [{ connected: true, displayName: "Alice", userId: "@alice:example.cz" }],
      phase: "connected",
      roomId: "!ops:example.cz",
      title: "Operační"
    });
    expect(methods).toContain("calls.updatePresentation");
    await acknowledgeNativeCallAction({
      actionId: "10000000-0000-4000-8000-000000000001",
      callId: "call-1",
      roomId: "!ops:example.cz",
      status: "succeeded"
    });
    expect(methods).toContain("calls.acknowledgeAction");
    expireNextSession = true;
    await expect(
      acknowledgeNativeCallAction({
        actionId: "10000000-0000-4000-8000-000000000001",
        callId: "call-1",
        roomId: "!ops:example.cz",
        status: "succeeded"
      })
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(handshakeCount).toBe(2);
    await presentNativeChat();
    expect(methods).toContain("communications.openChat");
    stopCalls();
    stop();
  });
});
