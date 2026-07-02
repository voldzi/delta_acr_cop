import * as React from "react";
import {
  fetchMessagingBootstrap,
  type MessagingConversationSummary
} from "@cop/core/cop-data";
import {
  clearMatrixMessagingCryptoStateForBootstrap,
  createMatrixMessagingSession,
  isMatrixAccountStoreMismatchError
} from "@cop/messaging/matrixClient";
import { getOrCreateMatrixDeviceId, rotateMatrixDeviceId } from "@cop/messaging/runtime";
import type {
  MatrixEncryptionRecoveryStatus,
  MatrixMessagingSession,
  MatrixRoomSummary,
  MatrixUserProfileSyncInput
} from "@cop/messaging/types";

export type MatrixSessionLifecycle = "idle" | "starting" | "ready" | "recovery-needed" | "error";

export interface MatrixSessionState {
  error: string | null;
  lifecycle: MatrixSessionLifecycle;
  loading: boolean;
  recoveryStatus: MatrixEncryptionRecoveryStatus | null;
  session: MatrixMessagingSession | null;
  syncState: string;
}

export type MatrixSessionAction =
  | { type: "error"; message: string }
  | { type: "ready"; recoveryStatus: MatrixEncryptionRecoveryStatus | null; session: MatrixMessagingSession }
  | { type: "recovery-status"; recoveryStatus: MatrixEncryptionRecoveryStatus | null }
  | { type: "reset" }
  | { type: "start" }
  | { type: "sync-state"; syncState: string };

export const initialMatrixSessionState: MatrixSessionState = {
  error: null,
  lifecycle: "idle",
  loading: false,
  recoveryStatus: null,
  session: null,
  syncState: "idle"
};

export function matrixSessionReducer(state: MatrixSessionState, action: MatrixSessionAction): MatrixSessionState {
  switch (action.type) {
    case "error":
      return {
        ...state,
        error: action.message,
        lifecycle: "error",
        loading: false
      };
    case "ready":
      return {
        ...state,
        error: null,
        lifecycle: matrixSessionLifecycleFor(action.session, action.recoveryStatus),
        loading: false,
        recoveryStatus: action.recoveryStatus,
        session: action.session
      };
    case "recovery-status":
      return {
        ...state,
        lifecycle: matrixSessionLifecycleFor(state.session, action.recoveryStatus),
        recoveryStatus: action.recoveryStatus
      };
    case "reset":
      return initialMatrixSessionState;
    case "start":
      return {
        ...state,
        error: null,
        lifecycle: "starting",
        loading: true
      };
    case "sync-state":
      return {
        ...state,
        syncState: action.syncState
      };
    default:
      return state;
  }
}

export function matrixSessionLifecycleFor(
  session: MatrixMessagingSession | null,
  recoveryStatus: MatrixEncryptionRecoveryStatus | null
): MatrixSessionLifecycle {
  if (!session) {
    return "idle";
  }
  if (recoveryStatus && !recoveryStatus.ready) {
    return "recovery-needed";
  }
  return "ready";
}

interface UseMatrixSessionOptions {
  apiBase: string;
  authSubjectId: string | undefined;
  authToken: string | null | undefined;
  conversationsRef: React.MutableRefObject<MessagingConversationSummary[]>;
  matrixProfile: MatrixUserProfileSyncInput | undefined;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
  onRoomsChanged: (rooms: MatrixRoomSummary[], preferredSelection?: string | null) => void;
  onTimelineChanged: () => void;
}

export function useMatrixSession(options: UseMatrixSessionOptions): {
  encryptionRecoveryStatus: MatrixEncryptionRecoveryStatus | null;
  ensureMatrixSession: (preferredSelection?: string | null) => Promise<MatrixMessagingSession>;
  matrixLoading: boolean;
  matrixSession: MatrixMessagingSession | null;
  matrixSessionLifecycle: MatrixSessionLifecycle;
  matrixSessionRef: React.MutableRefObject<MatrixMessagingSession | null>;
  refreshEncryptionRecoveryStatus: (session?: MatrixMessagingSession | null) => Promise<MatrixEncryptionRecoveryStatus | null>;
  resetMatrixSession: () => void;
  startMatrixSession: (preferredSelection?: string | null, allowStoreRecovery?: boolean, authTokenOverride?: string | null, matrixDeviceIdOverride?: string | null) => Promise<MatrixMessagingSession | null>;
  syncState: string;
} {
  const [state, dispatch] = React.useReducer(matrixSessionReducer, initialMatrixSessionState);
  const sessionRef = React.useRef<MatrixMessagingSession | null>(null);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  const refreshEncryptionRecoveryStatus = React.useCallback(async (
    session = sessionRef.current
  ): Promise<MatrixEncryptionRecoveryStatus | null> => {
    if (!session) {
      dispatch({ type: "recovery-status", recoveryStatus: null });
      return null;
    }
    const nextStatus = await session.getEncryptionRecoveryStatus();
    dispatch({ type: "recovery-status", recoveryStatus: nextStatus });
    return nextStatus;
  }, []);

  const startMatrixSession = React.useCallback(async (
    preferredSelection?: string | null,
    allowStoreRecovery = true,
    authTokenOverride?: string | null,
    matrixDeviceIdOverride?: string | null
  ): Promise<MatrixMessagingSession | null> => {
    const currentOptions = optionsRef.current;
    const effectiveAuthToken = authTokenOverride ?? currentOptions.authToken;
    if (!effectiveAuthToken) {
      return null;
    }
    dispatch({ type: "start" });
    currentOptions.onError(null);
    try {
      const bootstrap = await fetchMessagingBootstrap(
        currentOptions.apiBase,
        effectiveAuthToken,
        matrixDeviceIdOverride ?? getOrCreateMatrixDeviceId(currentOptions.authSubjectId ?? "anonymous")
      );
      if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
        const message = bootstrap.detail ?? bootstrap.warnings[0] ?? "Zabezpečený chat není připravený.";
        currentOptions.onError(message);
        dispatch({ type: "error", message });
        return null;
      }
      sessionRef.current?.stop();
      const nextSession = await createMatrixMessagingSession(bootstrap, {
        onRoomsChanged: (nextRooms) => {
          currentOptions.onRoomsChanged(nextRooms, preferredSelection);
        },
        onSyncState: (nextSyncState) => dispatch({ type: "sync-state", syncState: nextSyncState }),
        onTimelineChanged: currentOptions.onTimelineChanged,
        profile: currentOptions.matrixProfile
      });
      const nextRooms = nextSession.getRooms();
      const recoveryStatus = await nextSession.getEncryptionRecoveryStatus();
      sessionRef.current = nextSession;
      dispatch({ type: "ready", recoveryStatus, session: nextSession });
      currentOptions.onRoomsChanged(nextRooms, preferredSelection);
      currentOptions.onTimelineChanged();
      dispatch({ type: "sync-state", syncState: "starting" });
      return nextSession;
    } catch (caught) {
      if (allowStoreRecovery && isMatrixAccountStoreMismatchError(caught)) {
        try {
          const latestOptions = optionsRef.current;
          const latestAuthToken = authTokenOverride ?? latestOptions.authToken;
          if (!latestAuthToken) {
            return null;
          }
          const replacementDeviceId = rotateMatrixDeviceId(latestOptions.authSubjectId ?? "anonymous");
          const bootstrap = await fetchMessagingBootstrap(
            latestOptions.apiBase,
            latestAuthToken,
            replacementDeviceId
          );
          await clearMatrixMessagingCryptoStateForBootstrap(bootstrap);
          latestOptions.onNotice("Lokální šifrovací stav byl obnoven na novém webovém zařízení.");
          return startMatrixSession(preferredSelection, false, latestAuthToken, replacementDeviceId);
        } catch (recoveryCaught) {
          const message = recoveryCaught instanceof Error ? recoveryCaught.message : "Lokální šifrovací stav se nepodařilo obnovit.";
          optionsRef.current.onError(message);
          dispatch({ type: "error", message });
          return null;
        }
      }
      const message = caught instanceof Error ? caught.message : "Matrix spojení se nepodařilo spustit.";
      optionsRef.current.onError(message);
      dispatch({ type: "error", message });
      return null;
    }
  }, []);

  const ensureMatrixSession = React.useCallback(async (
    preferredSelection?: string | null
  ): Promise<MatrixMessagingSession> => {
    if (sessionRef.current) {
      return sessionRef.current;
    }
    const nextSession = await startMatrixSession(preferredSelection);
    if (!nextSession) {
      throw new Error("Chatové spojení se nepodařilo připravit.");
    }
    return nextSession;
  }, [startMatrixSession]);

  const resetMatrixSession = React.useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  React.useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  return {
    encryptionRecoveryStatus: state.recoveryStatus,
    ensureMatrixSession,
    matrixLoading: state.loading,
    matrixSession: state.session,
    matrixSessionLifecycle: state.lifecycle,
    matrixSessionRef: sessionRef,
    refreshEncryptionRecoveryStatus,
    resetMatrixSession,
    startMatrixSession,
    syncState: state.syncState
  };
}
