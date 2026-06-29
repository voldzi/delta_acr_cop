import { describe, expect, it, vi } from "vitest";

import {
  initialMatrixSessionState,
  matrixSessionLifecycleFor,
  matrixSessionReducer,
  type MatrixSessionState
} from "./useMatrixSession";
import type {
  MatrixEncryptionRecoveryStatus,
  MatrixMessagingSession
} from "@cop/messaging/types";

function sessionStub(): MatrixMessagingSession {
  return {
    bootstrap: {
      chatAvailable: true,
      contractVersion: "cop-messaging-bootstrap-v1",
      enabled: true,
      providerId: "csm.messaging",
      status: "online",
      tokenAvailable: true,
      warnings: []
    },
    createEncryptionRecovery: vi.fn(),
    createGroupRoom: vi.fn(),
    deleteMessage: vi.fn(),
    downloadAttachment: vi.fn(),
    getEncryptionRecoveryStatus: vi.fn(),
    getRooms: vi.fn(),
    getTimeline: vi.fn(),
    inviteUsersToRoom: vi.fn(),
    joinInvitedRooms: vi.fn(),
    leaveRoom: vi.fn(),
    loadMoreTimeline: vi.fn(),
    markRoomRead: vi.fn(),
    prepareEncryptionRecoveryForMobile: vi.fn(),
    restoreEncryptionRecovery: vi.fn(),
    setMessageRetentionPolicy: vi.fn(),
    sendAttachment: vi.fn(),
    sendLocation: vi.fn(),
    sendMessage: vi.fn(),
    sendReaction: vi.fn(),
    setReaction: vi.fn(),
    stop: vi.fn(),
    syncUserProfile: vi.fn()
  };
}

function recoveryStatus(ready: boolean): MatrixEncryptionRecoveryStatus {
  return {
    canPrepareForMobile: ready,
    crossSigningReady: ready,
    keyBackupEnabled: ready,
    keyBackupExists: ready,
    matrixRustCompatible: ready,
    needsRecovery: !ready,
    needsSetup: !ready,
    ready,
    secretStorageReady: ready,
    supported: true
  };
}

describe("matrixSessionReducer", () => {
  it("models start, ready, recovery-needed and reset lifecycle states", () => {
    let state: MatrixSessionState = initialMatrixSessionState;
    const session = sessionStub();

    state = matrixSessionReducer(state, { type: "start" });
    expect(state).toMatchObject({ lifecycle: "starting", loading: true });

    state = matrixSessionReducer(state, {
      recoveryStatus: recoveryStatus(false),
      session,
      type: "ready"
    });
    expect(state).toMatchObject({
      lifecycle: "recovery-needed",
      loading: false,
      session
    });

    state = matrixSessionReducer(state, {
      recoveryStatus: recoveryStatus(true),
      type: "recovery-status"
    });
    expect(state.lifecycle).toBe("ready");

    expect(matrixSessionReducer(state, { type: "reset" })).toEqual(initialMatrixSessionState);
  });

  it("keeps sync state independent from connection lifecycle", () => {
    const state = matrixSessionReducer(initialMatrixSessionState, {
      syncState: "SYNCING",
      type: "sync-state"
    });

    expect(state.syncState).toBe("SYNCING");
    expect(state.lifecycle).toBe("idle");
  });

  it("records a failed session start as an error state", () => {
    expect(matrixSessionReducer(initialMatrixSessionState, {
      message: "Matrix spojení se nepodařilo spustit.",
      type: "error"
    })).toMatchObject({
      error: "Matrix spojení se nepodařilo spustit.",
      lifecycle: "error",
      loading: false
    });
  });
});

describe("matrixSessionLifecycleFor", () => {
  it("treats unavailable recovery as ready once a session exists", () => {
    expect(matrixSessionLifecycleFor(sessionStub(), null)).toBe("ready");
  });

  it("returns idle without an active session", () => {
    expect(matrixSessionLifecycleFor(null, recoveryStatus(true))).toBe("idle");
  });
});
