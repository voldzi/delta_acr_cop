// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MuteDialog from "./MuteDialog";

describe("MuteDialog", () => {
  it("selects a mute duration", () => {
    const onMute = vi.fn();
    render(<MuteDialog title="Krizový tým" onClose={vi.fn()} onMute={onMute} />);

    expect(screen.getByRole("dialog", { name: "Ztlumit Krizový tým" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "1 týden" }));
    expect(onMute).toHaveBeenCalledWith("1w");
  });

  it("closes from the cancel button", () => {
    const onClose = vi.fn();
    render(<MuteDialog title="Krizový tým" onClose={onClose} onMute={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Zrušit" }));
    expect(onClose).toHaveBeenCalled();
  });
});
