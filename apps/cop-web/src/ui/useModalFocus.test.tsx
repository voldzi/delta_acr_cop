// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useModalFocus } from "./useModalFocus";

describe("useModalFocus", () => {
  it("traps keyboard focus, closes on Escape and restores the opener", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(<ModalHarness />);
    const opener = screen.getByRole("button", { name: "Otevřít galerii" });
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByRole("button", { name: "Předchozí" });
    const last = screen.getByRole("button", { name: "Zavřít" });
    for (const element of [first, last]) {
      Object.defineProperty(element, "getClientRects", { configurable: true, value: () => [{ width: 1 }] });
    }

    act(() => frames.shift()?.(16));
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

function ModalHarness() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Otevřít galerii
      </button>
      {open ? <TestModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TestModal({ onClose }: { onClose: () => void }) {
  const modal = useModalFocus<HTMLElement>(onClose);
  return (
    <section ref={modal.dialogRef} onKeyDown={modal.onDialogKeyDown} role="dialog" tabIndex={-1}>
      <button type="button">Předchozí</button>
      <button onClick={onClose} type="button">
        Zavřít
      </button>
    </section>
  );
}
