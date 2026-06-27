// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DeleteChatDialog from "./DeleteChatDialog";

describe("DeleteChatDialog", () => {
  it("confirms hiding a chat from the list", () => {
    const onConfirm = vi.fn();
    render(<DeleteChatDialog title="Krizový tým" onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByRole("dialog", { name: "Smazat Krizový tým" })).toBeTruthy();
    expect(screen.getByText(/Historie zpráv na serveru zůstane zachovaná/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Smazat ze seznamu" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("closes without confirming", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteChatDialog title="Krizový tým" onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Zrušit" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
