/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MatrixMessagingSession,
  MatrixVoiceCallWakeRequest,
  MessagingBootstrapResponse
} from "@cop/messaging/types";

const mocks = vi.hoisted(() => ({
  clearCryptoState: vi.fn(),
  completeResetAuth: vi.fn(),
  createSession: vi.fn(),
  fetchBootstrap: vi.fn(),
  getDeviceId: vi.fn(() => "COPWEB.TESTDEVICE"),
  isStoreMismatch: vi.fn(() => false),
  rotateDeviceId: vi.fn(() => "COPWEB.REPLACEMENT")
}));

vi.mock("@cop/core/cop-data", () => ({
  completeMessagingE2eeResetAuth: mocks.completeResetAuth,
  fetchMessagingBootstrap: mocks.fetchBootstrap
}));

vi.mock("@cop/messaging/matrixClient", () => ({
  clearMatrixMessagingCryptoStateForBootstrap: mocks.clearCryptoState,
  createMatrixMessagingSession: mocks.createSession,
  isMatrixAccountStoreMismatchError: mocks.isStoreMismatch
}));

vi.mock("@cop/messaging/runtime", () => ({
  getOrCreateMatrixDeviceId: mocks.getDeviceId,
  rotateMatrixDeviceId: mocks.rotateDeviceId
}));

import { useMatrixSession } from "./useMatrixSession";

beforeEach(() => {
  mocks.completeResetAuth.mockReset().mockResolvedValue({ completed: true, warnings: [] });
});

afterEach(() => {
  mocks.clearCryptoState.mockReset();
  mocks.createSession.mockReset();
  mocks.fetchBootstrap.mockReset();
  mocks.getDeviceId.mockClear();
  mocks.isStoreMismatch.mockReset().mockReturnValue(false);
  mocks.rotateDeviceId.mockClear();
  vi.unstubAllGlobals();
});

describe("useMatrixSession lifecycle", () => {
  it("renews a compatible bootstrap in place and uses the latest COP token for call wake", async () => {
    const session = sessionStub();
    const initialBootstrap = bootstrap("matrix-token-1", "2026-07-10T12:20:00.000Z");
    const renewedBootstrap = bootstrap("matrix-token-2", "2026-07-10T12:40:00.000Z");
    mocks.fetchBootstrap.mockResolvedValueOnce(initialBootstrap).mockResolvedValueOnce(renewedBootstrap);
    mocks.createSession.mockResolvedValue(session);
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const onRoomsChanged = vi.fn();
    const onTimelineChanged = vi.fn();
    const getSensitiveActionAuthToken = vi.fn().mockResolvedValue("cop-token-sensitive");
    const { result, rerender, unmount } = renderHook(
      ({ authToken }) =>
        useMatrixSession({
          apiBase: "https://cop.example.test",
          authSubjectId: "operator-1",
          authToken,
          conversationsRef: { current: [] },
          getSensitiveActionAuthToken,
          matrixProfile: undefined,
          onError: vi.fn(),
          onNotice: vi.fn(),
          onRoomsChanged,
          onTimelineChanged
        }),
      { initialProps: { authToken: "cop-token-1" } }
    );

    await act(async () => {
      await result.current.startMatrixSession();
    });
    rerender({ authToken: "cop-token-2" });
    await act(async () => {
      await result.current.startMatrixSession();
    });

    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(session.refreshBootstrap).toHaveBeenCalledWith(renewedBootstrap);
    expect(session.stop).not.toHaveBeenCalled();
    expect(result.current.matrixSession).toBe(session);

    const callbacks = mocks.createSession.mock.calls[0]?.[1] as {
      onVoiceCallWake?: (request: MatrixVoiceCallWakeRequest) => Promise<void>;
    };
    await callbacks.onVoiceCallWake?.({ action: "invite", callId: "call-1", roomId: "!room:example.test" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cop.example.test/api/v1/messaging/calls/wake",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer cop-token-2" })
      })
    );

    const signingCallbacks = mocks.createSession.mock.calls[0]?.[1] as {
      completeDeviceSigningAuth?: (request: {
        deviceId: string;
        masterKey: Record<string, unknown>;
        selfSigningKey: Record<string, unknown>;
        userSigningKey: Record<string, unknown>;
      }) => Promise<void>;
    };
    await signingCallbacks.completeDeviceSigningAuth?.({
      deviceId: "COPWEB.TESTDEVICE",
      masterKey: { usage: ["master"] },
      selfSigningKey: { usage: ["self_signing"] },
      userSigningKey: { usage: ["user_signing"] }
    });
    expect(getSensitiveActionAuthToken).toHaveBeenCalledTimes(1);
    expect(mocks.completeResetAuth).toHaveBeenCalledWith(
      "https://cop.example.test",
      "cop-token-sensitive",
      expect.objectContaining({ deviceId: "COPWEB.TESTDEVICE" })
    );

    unmount();
  });

  it("coalesces concurrent starts and never publishes a session completed after reset", async () => {
    const pendingSession = deferred<MatrixMessagingSession>();
    const staleSession = sessionStub();
    mocks.fetchBootstrap.mockResolvedValue(bootstrap("matrix-token-1", "2026-07-10T12:20:00.000Z"));
    mocks.createSession.mockReturnValue(pendingSession.promise);
    const { result } = renderHook(() =>
      useMatrixSession({
        apiBase: "https://cop.example.test",
        authSubjectId: "operator-1",
        authToken: "cop-token-1",
        conversationsRef: { current: [] },
        matrixProfile: undefined,
        onError: vi.fn(),
        onNotice: vi.fn(),
        onRoomsChanged: vi.fn(),
        onTimelineChanged: vi.fn()
      })
    );

    let firstStart!: Promise<MatrixMessagingSession | null>;
    let secondStart!: Promise<MatrixMessagingSession | null>;
    act(() => {
      firstStart = result.current.startMatrixSession();
      secondStart = result.current.startMatrixSession();
    });
    expect(firstStart).toBe(secondStart);
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalledTimes(1));

    act(() => result.current.resetMatrixSession());
    pendingSession.resolve(staleSession);
    await act(async () => {
      await expect(firstStart).resolves.toBeNull();
    });

    expect(staleSession.stop).toHaveBeenCalledTimes(1);
    expect(result.current.matrixSession).toBeNull();
    expect(result.current.matrixSessionRef.current).toBeNull();
  });

  it("restarts atomically and reports the original browser failure to a sensitive action", async () => {
    const initialSession = sessionStub();
    const browserFailure = new Error("IndexedDB is blocked by another Matrix connection");
    mocks.fetchBootstrap
      .mockResolvedValueOnce(bootstrap("matrix-token-1", "2026-07-10T12:20:00.000Z"))
      .mockResolvedValueOnce({
        ...bootstrap("matrix-token-2", "2026-07-10T12:40:00.000Z"),
        deviceId: "COPWEB.REPLACEMENT"
      });
    mocks.createSession.mockResolvedValueOnce(initialSession).mockRejectedValueOnce(browserFailure);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMatrixSession({
        apiBase: "https://cop.example.test",
        authSubjectId: "operator-1",
        authToken: "cop-token-1",
        conversationsRef: { current: [] },
        matrixProfile: undefined,
        onError,
        onNotice: vi.fn(),
        onRoomsChanged: vi.fn(),
        onTimelineChanged: vi.fn()
      })
    );

    await act(async () => {
      await result.current.startMatrixSession();
    });

    await act(async () => {
      await expect(
        result.current.restartMatrixSession(null, true, "fresh-cop-token", "COPWEB.REPLACEMENT")
      ).rejects.toThrow(browserFailure.message);
    });

    expect(initialSession.stop).toHaveBeenCalledTimes(1);
    expect(mocks.fetchBootstrap).toHaveBeenNthCalledWith(
      2,
      "https://cop.example.test",
      "fresh-cop-token",
      "COPWEB.REPLACEMENT"
    );
    expect(onError).toHaveBeenLastCalledWith(browserFailure.message);
    expect(result.current.matrixSession).toBeNull();
  });
});

function bootstrap(accessToken: string, expiresAt: string): MessagingBootstrapResponse {
  return {
    accessToken,
    chatAvailable: true,
    contractVersion: "cop-messaging-bootstrap-v1",
    deviceId: "COPWEB.TESTDEVICE",
    e2eeRequired: true,
    enabled: true,
    expiresAt,
    homeserverBaseUrl: "https://msg.example.test",
    providerId: "csm.messaging",
    status: "online",
    tokenAvailable: true,
    userId: "@operator:example.test",
    warnings: []
  };
}

function sessionStub(): MatrixMessagingSession {
  return {
    answerVoiceCall: vi.fn(),
    bootstrap: bootstrap("matrix-token-1", "2026-07-10T12:20:00.000Z"),
    createEncryptionRecovery: vi.fn(),
    createGroupRoom: vi.fn(),
    deleteMessage: vi.fn(),
    downloadAttachment: vi.fn(),
    getEncryptionRecoveryStatus: vi.fn(async () => ({
      canPrepareForMobile: true,
      crossSigningReady: true,
      keyBackupEnabled: true,
      keyBackupExists: true,
      matrixRustCompatible: true,
      needsRecovery: false,
      needsSetup: false,
      ready: true,
      secretStorageReady: true,
      supported: true
    })),
    getRooms: vi.fn(() => []),
    getTimeline: vi.fn(() => []),
    getVoiceCall: vi.fn(() => null),
    hangupVoiceCall: vi.fn(),
    inviteUsersToRoom: vi.fn(),
    inviteVoiceCallParticipants: vi.fn(),
    joinInvitedRooms: vi.fn(),
    leaveRoom: vi.fn(),
    loadMoreTimeline: vi.fn(),
    markRoomRead: vi.fn(),
    prepareEncryptionRecoveryForMobile: vi.fn(),
    refreshBootstrap: vi.fn(() => true),
    rejectVoiceCall: vi.fn(),
    restoreEncryptionRecovery: vi.fn(),
    sendAttachment: vi.fn(),
    sendLocation: vi.fn(),
    sendMessage: vi.fn(),
    sendReaction: vi.fn(),
    sendTransitShare: vi.fn(),
    setMessageRetentionPolicy: vi.fn(),
    setReaction: vi.fn(),
    setVoiceCallMuted: vi.fn(),
    startVoiceCall: vi.fn(),
    stop: vi.fn(),
    syncUserProfile: vi.fn(),
    syncWebPushPusher: vi.fn()
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
