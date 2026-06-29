// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DeleteChatDialog from "./DeleteChatDialog";

describe("DeleteChatDialog", () => {
  it("offers local hiding for a direct chat", () => {
    const onHide = vi.fn();
    const onLeaveGroup = vi.fn();
    render(
      <DeleteChatDialog
        canLeaveGroup={false}
        chatKind="direct"
        title="Krizový tým"
        onClose={vi.fn()}
        onHide={onHide}
        onLeaveGroup={onLeaveGroup}
      />
    );

    expect(screen.getByRole("dialog", { name: "Správa chatu Krizový tým" })).toBeTruthy();
    expect(screen.getByText(/Historie na serveru zůstane zachovaná/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skrýt chat" }));
    expect(onHide).toHaveBeenCalled();
    expect(onLeaveGroup).not.toHaveBeenCalled();
  });

  it("offers leaving a Matrix-backed group", () => {
    const onHide = vi.fn();
    const onLeaveGroup = vi.fn();
    render(
      <DeleteChatDialog
        canLeaveGroup
        chatKind="group"
        title="Povodňový tým"
        onClose={vi.fn()}
        onHide={onHide}
        onLeaveGroup={onLeaveGroup}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Opustit skupinu" }));
    expect(onLeaveGroup).toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("closes without confirming", () => {
    const onClose = vi.fn();
    const onHide = vi.fn();
    const onLeaveGroup = vi.fn();
    render(
      <DeleteChatDialog
        canLeaveGroup={false}
        chatKind="direct"
        title="Krizový tým"
        onClose={onClose}
        onHide={onHide}
        onLeaveGroup={onLeaveGroup}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Zrušit" }));
    expect(onClose).toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
    expect(onLeaveGroup).not.toHaveBeenCalled();
  });
});
