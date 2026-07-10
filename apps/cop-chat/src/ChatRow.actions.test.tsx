// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatRow, type ChatListItem } from "./ChatApp";

function chatItem(): ChatListItem {
  return {
    active: false,
    id: "room:!test",
    memberCount: 2,
    muted: false,
    pinned: false,
    preferenceKey: "room:!test",
    preview: "Nový chat",
    roomId: "!test",
    searchable: "Testovací chat",
    sortAt: 1,
    title: "Testovací chat",
    type: "direct",
    unreadCount: 0
  };
}

describe("ChatRow accessible actions", () => {
  it("opens pin and unread actions without a swipe gesture", async () => {
    const item = chatItem();
    const onTogglePinned = vi.fn();
    const onToggleUnread = vi.fn();
    render(
      <ChatRow
        connectionState="online"
        item={item}
        onDeleteRequest={vi.fn()}
        onOpen={vi.fn()}
        onToggleMute={vi.fn()}
        onTogglePinned={onTogglePinned}
        onToggleUnread={onToggleUnread}
        preparing={false}
      />
    );

    const actionsToggle = screen.getByRole("button", { name: "Akce chatu Testovací chat" });
    fireEvent.click(actionsToggle);

    const pinAction = screen.getByRole("button", { name: "Připnout" });
    await waitFor(() => expect(document.activeElement).toBe(pinAction));
    fireEvent.click(pinAction);
    expect(onTogglePinned).toHaveBeenCalledWith(item);

    fireEvent.click(actionsToggle);
    const unreadAction = screen.getByRole("button", { name: "Nepřečtené" });
    fireEvent.click(unreadAction);
    expect(onToggleUnread).toHaveBeenCalledWith(item);
  });

  it("coalesces touch swipe updates into one animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const view = render(
      <ChatRow
        connectionState="online"
        item={chatItem()}
        onDeleteRequest={vi.fn()}
        onOpen={vi.fn()}
        onToggleMute={vi.fn()}
        onTogglePinned={vi.fn()}
        onToggleUnread={vi.fn()}
        preparing={false}
      />
    );
    const row = view.container.querySelector<HTMLElement>(".chat-row");
    expect(row).toBeTruthy();
    Object.defineProperty(row, "setPointerCapture", { configurable: true, value: vi.fn() });

    fireEvent.pointerDown(row as HTMLElement, { clientX: 200, clientY: 20, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(row as HTMLElement, { clientX: 170, clientY: 20, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(row as HTMLElement, { clientX: 140, clientY: 20, pointerId: 1, pointerType: "touch" });

    expect(animationFrame).toHaveBeenCalledTimes(1);
    act(() => callbacks.shift()?.(16));
    expect(row?.style.transform).toBe("translateX(-60px)");
    animationFrame.mockRestore();
  });
});
