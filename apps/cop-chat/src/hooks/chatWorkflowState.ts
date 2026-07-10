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
  const sessionReady =
    input.matrixSessionActive && input.matrixLifecycle !== "starting" && input.matrixLifecycle !== "error";
  const needsRecovery = input.matrixSessionActive && !input.recoveryReady;
  // An active Matrix crypto session can safely encrypt new messages even when
  // this device has not unlocked account key backup yet. Recovery controls
  // access to older room keys; it must remain visible as a warning, not turn
  // the mobile textarea into a disabled control that cannot open the keyboard.
  const composerEnabled = Boolean(chatReady && sessionReady && input.selectedRoomId && !input.preparingChat);

  return {
    canForwardMessages: Boolean(
      chatReady && sessionReady && input.forwardDraftCount > 0 && input.selectedForwardTargetCount > 0
    ),
    canOpenChat: chatReady && !input.preparingChat,
    canSendMessage: composerEnabled && !input.sending,
    composerEnabled,
    composerMode: input.surface,
    needsRecovery
  };
}
