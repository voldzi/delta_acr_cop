// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatActionMenu, MessageSearchBar, SelectionToolbar } from "./ConversationControls";

describe("ConversationControls", () => {
  it("renders contact actions and calls the selected handler", () => {
    const onInfo = vi.fn();
    const onSituationSummary = vi.fn();
    const onTogglePinned = vi.fn();
    render(
      <ChatActionMenu
        activeChat={{ pinned: false, type: "direct" }}
        muted={false}
        onInfo={onInfo}
        onManage={vi.fn()}
        onMute={vi.fn()}
        onRecovery={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        onSituationSummary={onSituationSummary}
        onToggleMute={vi.fn()}
        onTogglePinned={onTogglePinned}
      />
    );

    expect(screen.getByRole("menu", { name: "Akce chatu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /O kontaktu/u }));
    expect(onInfo).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /AI situační souhrn/u }));
    expect(onSituationSummary).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /Připnout/u }));
    expect(onTogglePinned).toHaveBeenCalled();
  });

  it("switches muted menu item to unmute action", () => {
    const onAddMember = vi.fn();
    const onManage = vi.fn();
    const onToggleMute = vi.fn();
    const onMute = vi.fn();
    render(
      <ChatActionMenu
        activeChat={{ pinned: true, type: "group" }}
        canAddMember
        muted
        onAddMember={onAddMember}
        onInfo={vi.fn()}
        onManage={onManage}
        onMute={onMute}
        onRecovery={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        onSituationSummary={vi.fn()}
        onToggleMute={onToggleMute}
        onTogglePinned={vi.fn()}
      />
    );

    expect(screen.getByRole("menuitem", { name: /O skupině/u })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Odepnout/u })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /Přidat člena/u }));
    expect(onAddMember).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /Zrušit ztlumení/u }));
    expect(onToggleMute).toHaveBeenCalled();
    expect(onMute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /Správa skupiny/u }));
    expect(onManage).toHaveBeenCalled();
  });

  it("reports message search changes and movement", () => {
    const onQueryChange = vi.fn();
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <MessageSearchBar
        activeIndex={1}
        matchCount={3}
        query="test"
        onClose={onClose}
        onMove={onMove}
        onQueryChange={onQueryChange}
      />
    );

    expect(screen.getByText("2/3")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Hledat ve zprávách" }), { target: { value: "riziko" } });
    expect(onQueryChange).toHaveBeenCalledWith("riziko");

    fireEvent.click(screen.getByRole("button", { name: "Předchozí výsledek" }));
    expect(onMove).toHaveBeenCalledWith(-1);

    fireEvent.click(screen.getByRole("button", { name: "Hotovo" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables message selection actions without a selected message", () => {
    render(
      <SelectionToolbar
        count={0}
        onCancel={vi.fn()}
        onCopy={vi.fn()}
        onForward={vi.fn()}
        onShare={vi.fn()}
      />
    );

    expect(screen.getByText("Vybráno 0")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Přeposlat/u }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Zkopírovat/u }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Sdílet/u }) as HTMLButtonElement).disabled).toBe(true);
  });
});
