import * as React from "react";
import { fetchMessagingBootstrap, type MessagingConversationSummary } from "@cop/core/cop-data";
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
  MatrixUserProfileSyncInput,
  MatrixVoiceCallSnapshot,
  MatrixVoiceCallWakeRequest,
  MatrixWebPushPusherOptions
} from "@cop/messaging/types";

export type MatrixSessionLifecycle = "idle" | "starting" | "ready" | "recovery-needed" | "error";

export interface MatrixSessionState {
  error: string | null;
  lastReadyAt: number | null;
  lastStartedAt: number | null;
  lastSyncAt: number | null;
  lifecycle: MatrixSessionLifecycle;
  loading: boolean;
  recoveryStatus: MatrixEncryptionRecoveryStatus | null;
  session: MatrixMessagingSession | null;
  syncState: string;
}

export type MatrixSessionAction =
  | { type: "error"; message: string; observedAt?: number }
  | {
      type: "ready";
      observedAt?: number;
      recoveryStatus: MatrixEncryptionRecoveryStatus | null;
      session: MatrixMessagingSession;
    }
  | { type: "recovery-status"; recoveryStatus: MatrixEncryptionRecoveryStatus | null }
  | { type: "replace" }
  | { type: "reset" }
  | { type: "start"; observedAt?: number }
  | { type: "sync-state"; observedAt?: number; syncState: string };

export const initialMatrixSessionState: MatrixSessionState = {
  error: null,
  lastReadyAt: null,
  lastStartedAt: null,
  lastSyncAt: null,
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
        loading: false,
        lastSyncAt: action.observedAt ?? Date.now()
      };
    case "ready":
      return {
        ...state,
        error: null,
        lastReadyAt: action.observedAt ?? Date.now(),
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
    case "replace":
      return {
        ...state,
        lifecycle: "starting",
        loading: true,
        recoveryStatus: null,
        session: null
      };
    case "reset":
      return initialMatrixSessionState;
    case "start":
      return {
        ...state,
        error: null,
        lastStartedAt: action.observedAt ?? Date.now(),
        lifecycle: "starting",
        loading: true,
        syncState: "starting"
      };
    case "sync-state":
      return {
        ...state,
        lastSyncAt: action.observedAt ?? Date.now(),
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
  matrixWebPushDeviceId?: string;
  matrixWebPushFallbackDeviceId?: string;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
  onRoomsChanged: (rooms: MatrixRoomSummary[], preferredSelection?: string | null) => void;
  onTimelineChanged: () => void;
  onVoiceCallChanged?: (call: MatrixVoiceCallSnapshot | null) => void;
}

export function useMatrixSession(options: UseMatrixSessionOptions): {
  encryptionRecoveryStatus: MatrixEncryptionRecoveryStatus | null;
  ensureMatrixSession: (preferredSelection?: string | null) => Promise<MatrixMessagingSession>;
  matrixLoading: boolean;
  matrixLastReadyAt: number | null;
  matrixLastStartedAt: number | null;
  matrixLastSyncAt: number | null;
  matrixSession: MatrixMessagingSession | null;
  matrixSessionLifecycle: MatrixSessionLifecycle;
  matrixSessionRef: React.MutableRefObject<MatrixMessagingSession | null>;
  refreshEncryptionRecoveryStatus: (
    session?: MatrixMessagingSession | null
  ) => Promise<MatrixEncryptionRecoveryStatus | null>;
  resetMatrixSession: () => void;
  updateMatrixWebPushPusher: () => Promise<void>;
  startMatrixSession: (
    preferredSelection?: string | null,
    allowStoreRecovery?: boolean,
    authTokenOverride?: string | null,
    matrixDeviceIdOverride?: string | null
  ) => Promise<MatrixMessagingSession | null>;
  syncState: string;
} {
  const [state, dispatch] = React.useReducer(matrixSessionReducer, initialMatrixSessionState);
  const sessionRef = React.useRef<MatrixMessagingSession | null>(null);
  const startGenerationRef = React.useRef(0);
  const startPromiseRef = React.useRef<Promise<MatrixMessagingSession | null> | null>(null);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  const refreshEncryptionRecoveryStatus = React.useCallback(
    async (session = sessionRef.current): Promise<MatrixEncryptionRecoveryStatus | null> => {
      if (!session) {
        dispatch({ type: "recovery-status", recoveryStatus: null });
        return null;
      }
      const nextStatus = await session.getEncryptionRecoveryStatus();
      dispatch({ type: "recovery-status", recoveryStatus: nextStatus });
      return nextStatus;
    },
    []
  );

  const updateMatrixWebPushPusher = React.useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    const currentOptions = optionsRef.current;
    const deviceId = currentOptions.matrixWebPushDeviceId ?? currentOptions.matrixWebPushFallbackDeviceId;
    const pushGatewayUrl = browserMatrixPushGatewayUrl();
    const pusher: MatrixWebPushPusherOptions = {
      ...(deviceId ? { deviceId } : {}),
      lang: typeof navigator !== "undefined" ? navigator.language || "cs" : "cs",
      ...(pushGatewayUrl ? { pushGatewayUrl } : {}),
      registered: Boolean(currentOptions.matrixWebPushDeviceId)
    };
    await session.syncWebPushPusher(pusher);
  }, []);

  const startMatrixSession = React.useCallback(
    (
      preferredSelection?: string | null,
      allowStoreRecovery = true,
      authTokenOverride?: string | null,
      matrixDeviceIdOverride?: string | null
    ): Promise<MatrixMessagingSession | null> => {
      if (startPromiseRef.current) {
        return startPromiseRef.current;
      }
      const initialOptions = optionsRef.current;
      const initialAuthToken = authTokenOverride ?? initialOptions.authToken;
      if (!initialAuthToken) {
        return Promise.resolve(null);
      }
      const generation = ++startGenerationRef.current;
      dispatch({ type: "start" });
      initialOptions.onError(null);

      const runStart = async (
        canRecoverStore: boolean,
        tokenOverride: string | null | undefined,
        deviceIdOverride: string | null | undefined
      ): Promise<MatrixMessagingSession | null> => {
        let candidateSession: MatrixMessagingSession | null = null;
        try {
          const currentOptions = optionsRef.current;
          const effectiveAuthToken = tokenOverride ?? currentOptions.authToken;
          if (!effectiveAuthToken || generation !== startGenerationRef.current) {
            return null;
          }
          const bootstrap = await fetchMessagingBootstrap(
            currentOptions.apiBase,
            effectiveAuthToken,
            deviceIdOverride ?? getOrCreateMatrixDeviceId(currentOptions.authSubjectId ?? "anonymous")
          );
          if (generation !== startGenerationRef.current) {
            return null;
          }
          if (!bootstrap.chatAvailable || !bootstrap.tokenAvailable || !bootstrap.accessToken) {
            throw new Error(bootstrap.detail ?? bootstrap.warnings[0] ?? "Zabezpečený chat není připravený.");
          }

          const currentSession = sessionRef.current;
          if (currentSession?.refreshBootstrap(bootstrap)) {
            const recoveryStatus = await currentSession.getEncryptionRecoveryStatus();
            if (generation !== startGenerationRef.current || sessionRef.current !== currentSession) {
              return null;
            }
            const latestOptions = optionsRef.current;
            dispatch({ type: "ready", recoveryStatus, session: currentSession });
            latestOptions.onRoomsChanged(currentSession.getRooms(), preferredSelection);
            latestOptions.onTimelineChanged();
            return currentSession;
          }

          if (currentSession && sessionRef.current === currentSession) {
            sessionRef.current = null;
            dispatch({ type: "replace" });
            currentSession.stop();
          }

          const latestOptions = optionsRef.current;
          const matrixWebPushDeviceId =
            latestOptions.matrixWebPushDeviceId ?? latestOptions.matrixWebPushFallbackDeviceId;
          const matrixPushGatewayUrl = browserMatrixPushGatewayUrl();
          let callbackSession: MatrixMessagingSession | null = null;
          const callbacksAreCurrent = () =>
            generation === startGenerationRef.current ||
            Boolean(callbackSession && sessionRef.current === callbackSession);
          candidateSession = await createMatrixMessagingSession(bootstrap, {
            onRoomsChanged: (nextRooms) => {
              if (callbacksAreCurrent()) {
                optionsRef.current.onRoomsChanged(nextRooms, preferredSelection);
              }
            },
            onSyncState: (nextSyncState) => {
              if (callbacksAreCurrent()) {
                dispatch({ type: "sync-state", syncState: nextSyncState });
              }
            },
            onTimelineChanged: () => {
              if (callbacksAreCurrent()) {
                optionsRef.current.onTimelineChanged();
              }
            },
            onVoiceCallWake: (request) => {
              const wakeOptions = optionsRef.current;
              const wakeAuthToken = wakeOptions.authToken ?? effectiveAuthToken;
              if (!wakeAuthToken) {
                throw new Error("Voice call wake failed: COP authentication is unavailable");
              }
              return wakeMatrixVoiceCall(wakeOptions.apiBase, wakeAuthToken, request);
            },
            onVoiceCallChanged: (call) => {
              if (callbacksAreCurrent()) {
                optionsRef.current.onVoiceCallChanged?.(call);
              }
            },
            profile: latestOptions.matrixProfile,
            webPush: {
              ...(matrixWebPushDeviceId ? { deviceId: matrixWebPushDeviceId } : {}),
              lang: typeof navigator !== "undefined" ? navigator.language || "cs" : "cs",
              ...(matrixPushGatewayUrl ? { pushGatewayUrl: matrixPushGatewayUrl } : {}),
              registered: Boolean(latestOptions.matrixWebPushDeviceId)
            }
          });
          callbackSession = candidateSession;
          if (generation !== startGenerationRef.current) {
            candidateSession.stop();
            return null;
          }
          const nextRooms = candidateSession.getRooms();
          const recoveryStatus = await candidateSession.getEncryptionRecoveryStatus();
          if (generation !== startGenerationRef.current) {
            candidateSession.stop();
            return null;
          }
          sessionRef.current = candidateSession;
          dispatch({ type: "ready", recoveryStatus, session: candidateSession });
          optionsRef.current.onRoomsChanged(nextRooms, preferredSelection);
          optionsRef.current.onTimelineChanged();
          const readySession = candidateSession;
          candidateSession = null;
          return readySession;
        } catch (caught) {
          candidateSession?.stop();
          if (generation !== startGenerationRef.current) {
            return null;
          }
          if (canRecoverStore && isMatrixAccountStoreMismatchError(caught)) {
            try {
              const latestOptions = optionsRef.current;
              const latestAuthToken = tokenOverride ?? latestOptions.authToken;
              if (!latestAuthToken) {
                return null;
              }
              const replacementDeviceId = rotateMatrixDeviceId(latestOptions.authSubjectId ?? "anonymous");
              const replacementBootstrap = await fetchMessagingBootstrap(
                latestOptions.apiBase,
                latestAuthToken,
                replacementDeviceId
              );
              if (generation !== startGenerationRef.current) {
                return null;
              }
              await clearMatrixMessagingCryptoStateForBootstrap(replacementBootstrap);
              latestOptions.onNotice("Lokální šifrovací stav byl obnoven na novém webovém zařízení.");
              return runStart(false, latestAuthToken, replacementDeviceId);
            } catch (recoveryCaught) {
              if (generation !== startGenerationRef.current) {
                return null;
              }
              const message =
                recoveryCaught instanceof Error
                  ? recoveryCaught.message
                  : "Lokální šifrovací stav se nepodařilo obnovit.";
              optionsRef.current.onError(message);
              dispatch({ type: "error", message });
              return null;
            }
          }
          const message = caught instanceof Error ? caught.message : "Matrix spojení se nepodařilo spustit.";
          optionsRef.current.onError(message);
          dispatch({ type: "error", message });
          return sessionRef.current;
        }
      };

      const startPromise = runStart(allowStoreRecovery, authTokenOverride, matrixDeviceIdOverride);
      startPromiseRef.current = startPromise;
      void startPromise.finally(() => {
        if (startPromiseRef.current === startPromise) {
          startPromiseRef.current = null;
        }
      });
      return startPromise;
    },
    []
  );

  const ensureMatrixSession = React.useCallback(
    async (preferredSelection?: string | null): Promise<MatrixMessagingSession> => {
      if (sessionRef.current) {
        return sessionRef.current;
      }
      const nextSession = await startMatrixSession(preferredSelection);
      if (!nextSession) {
        throw new Error("Chatové spojení se nepodařilo připravit.");
      }
      return nextSession;
    },
    [startMatrixSession]
  );

  const resetMatrixSession = React.useCallback(() => {
    startGenerationRef.current += 1;
    startPromiseRef.current = null;
    const currentSession = sessionRef.current;
    sessionRef.current = null;
    currentSession?.stop();
    dispatch({ type: "reset" });
  }, []);

  React.useEffect(() => {
    return () => {
      startGenerationRef.current += 1;
      startPromiseRef.current = null;
      const currentSession = sessionRef.current;
      sessionRef.current = null;
      currentSession?.stop();
    };
  }, []);

  return {
    encryptionRecoveryStatus: state.recoveryStatus,
    ensureMatrixSession,
    matrixLoading: state.loading,
    matrixLastReadyAt: state.lastReadyAt,
    matrixLastStartedAt: state.lastStartedAt,
    matrixLastSyncAt: state.lastSyncAt,
    matrixSession: state.session,
    matrixSessionLifecycle: state.lifecycle,
    matrixSessionRef: sessionRef,
    refreshEncryptionRecoveryStatus,
    resetMatrixSession,
    startMatrixSession,
    updateMatrixWebPushPusher,
    syncState: state.syncState
  };
}

async function wakeMatrixVoiceCall(
  apiBase: string,
  authToken: string,
  request: MatrixVoiceCallWakeRequest
): Promise<void> {
  const response = await fetch(`${apiBase}/api/v1/messaging/calls/wake`, {
    body: JSON.stringify(request),
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json"
    },
    keepalive: true,
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Voice call wake failed: HTTP ${response.status}`);
  }
}

function browserMatrixPushGatewayUrl(): string | undefined {
  try {
    if (typeof window === "undefined" || typeof window.location?.origin !== "string" || !window.location.origin) {
      return undefined;
    }
    return new URL("/_matrix/push/v1/notify", window.location.origin).toString();
  } catch {
    return undefined;
  }
}
