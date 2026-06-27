import type { MatrixSessionLifecycle } from "./useMatrixSession";

export type ChatWorkflowSurface = "desktop" | "mobile";

export interface ChatWorkflowInput {
  authenticated: boolean;
  chatAvailable: boolean;
  forwardDraftCount: number;
  matrixLifecycle: MatrixSessionLifecycle;
  matrixSessionActive: boolean;
  preparingChat: boolean;
  recoveryReady: boolean;
  selectedForwardTargetCount: number;
  selectedRoomId: string | null;
  sending: boolean;
  surface: ChatWorkflowSurface;
}

export interface ChatWorkflowState {
  canForwardMessages: boolean;
  canOpenChat: boolean;
  canSendMessage: boolean;
  composerEnabled: boolean;
  composerMode: ChatWorkflowSurface;
  needsRecovery: boolean;
}

export function deriveChatWorkflowState(input: ChatWorkflowInput): ChatWorkflowState {
  const chatReady = input.authenticated && input.chatAvailable;
  const sessionReady = input.matrixSessionActive && input.matrixLifecycle !== "starting" && input.matrixLifecycle !== "error";
  const needsRecovery = input.matrixSessionActive && !input.recoveryReady;
  const composerEnabled = Boolean(
    chatReady
      && sessionReady
      && input.selectedRoomId
      && !input.preparingChat
      && input.recoveryReady
  );

  return {
    canForwardMessages: Boolean(
      chatReady
        && sessionReady
        && input.forwardDraftCount > 0
        && input.selectedForwardTargetCount > 0
        && input.recoveryReady
    ),
    canOpenChat: chatReady && !input.preparingChat,
    canSendMessage: composerEnabled && !input.sending,
    composerEnabled,
    composerMode: input.surface,
    needsRecovery
  };
}
