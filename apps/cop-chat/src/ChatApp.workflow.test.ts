import { describe, expect, it } from "vitest";

import { deriveChatWorkflowState, type ChatWorkflowInput } from "./hooks/chatWorkflowState";

describe("chat workflow scenarios", () => {
  it("keeps login blocked until Matrix session and E2EE recovery are ready", () => {
    const input: ChatWorkflowInput = {
      authenticated: true,
      chatAvailable: true,
      forwardDraftCount: 0,
      matrixLifecycle: "starting",
      matrixSessionActive: false,
      preparingChat: false,
      recoveryReady: false,
      selectedForwardTargetCount: 0,
      selectedRoomId: "!room:cop.local",
      sending: false,
      surface: "desktop"
    };
    const beforeSession = deriveChatWorkflowState(input);
    expect(beforeSession.canOpenChat).toBe(true);
    expect(beforeSession.composerEnabled).toBe(false);

    const recoveryMissing = deriveChatWorkflowState({
      ...input,
      matrixLifecycle: "recovery-needed",
      matrixSessionActive: true
    });
    expect(recoveryMissing.needsRecovery).toBe(true);
    expect(recoveryMissing.canSendMessage).toBe(false);

    const ready = deriveChatWorkflowState({
      ...input,
      matrixLifecycle: "ready",
      matrixSessionActive: true,
      recoveryReady: true
    });
    expect(ready.needsRecovery).toBe(false);
    expect(ready.canSendMessage).toBe(true);
  });

  it("enables a normal send only for a selected room with a ready session", () => {
    expect(deriveChatWorkflowState({
      authenticated: true,
      chatAvailable: true,
      forwardDraftCount: 0,
      matrixLifecycle: "ready",
      matrixSessionActive: true,
      preparingChat: false,
      recoveryReady: true,
      selectedForwardTargetCount: 0,
      selectedRoomId: "!room:cop.local",
      sending: false,
      surface: "desktop"
    }).canSendMessage).toBe(true);

    expect(deriveChatWorkflowState({
      authenticated: true,
      chatAvailable: true,
      forwardDraftCount: 0,
      matrixLifecycle: "ready",
      matrixSessionActive: true,
      preparingChat: false,
      recoveryReady: true,
      selectedForwardTargetCount: 0,
      selectedRoomId: null,
      sending: false,
      surface: "desktop"
    }).canSendMessage).toBe(false);
  });

  it("requires at least one forward target and one forwarded message", () => {
    const input: ChatWorkflowInput = {
      authenticated: true,
      chatAvailable: true,
      forwardDraftCount: 2,
      matrixLifecycle: "ready",
      matrixSessionActive: true,
      preparingChat: false,
      recoveryReady: true,
      selectedForwardTargetCount: 3,
      selectedRoomId: "!source:cop.local",
      sending: false,
      surface: "desktop"
    };
    const forwardReady = deriveChatWorkflowState(input);
    expect(forwardReady.canForwardMessages).toBe(true);

    expect(deriveChatWorkflowState({
      ...input,
      selectedForwardTargetCount: 0
    }).canForwardMessages).toBe(false);

    expect(deriveChatWorkflowState({
      ...input,
      forwardDraftCount: 0
    }).canForwardMessages).toBe(false);
  });

  it("keeps the same send gating for mobile composer mode", () => {
    const mobileState = deriveChatWorkflowState({
      authenticated: true,
      chatAvailable: true,
      forwardDraftCount: 0,
      matrixLifecycle: "ready",
      matrixSessionActive: true,
      preparingChat: false,
      recoveryReady: true,
      selectedForwardTargetCount: 0,
      selectedRoomId: "!room:cop.local",
      sending: false,
      surface: "mobile"
    });

    expect(mobileState.composerMode).toBe("mobile");
    expect(mobileState.composerEnabled).toBe(true);
    expect(mobileState.canSendMessage).toBe(true);
  });

  it("does not allow sending while a message is already being sent", () => {
    expect(deriveChatWorkflowState({
      authenticated: true,
      chatAvailable: true,
      forwardDraftCount: 0,
      matrixLifecycle: "ready",
      matrixSessionActive: true,
      preparingChat: false,
      recoveryReady: true,
      selectedForwardTargetCount: 0,
      selectedRoomId: "!room:cop.local",
      sending: true,
      surface: "desktop"
    }).canSendMessage).toBe(false);
  });
});
