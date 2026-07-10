// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "./ChatApp";

function composer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return (
    <Composer
      aiAgentAvailable={false}
      aiLocationActive={false}
      aiLocationBusy={false}
      disabled={false}
      embedded
      liveLocationActive={false}
      pendingAttachment={null}
      replyTo={null}
      sending={false}
      showJumpToLatest={false}
      onAttachmentClear={vi.fn()}
      onAttachmentPick={vi.fn()}
      onReplyClear={vi.fn()}
      onSend={vi.fn()}
      onJumpToLatest={vi.fn()}
      onShareLocation={vi.fn()}
      onStartLiveLocation={vi.fn()}
      onStopLiveLocation={vi.fn()}
      onUseAiLocation={vi.fn()}
      {...overrides}
    />
  );
}

describe("mobile Composer", () => {
  it("focuses the textarea when the user taps anywhere inside the message field", () => {
    render(composer());
    const textarea = screen.getByRole("textbox", { name: "Zpráva" });
    const messageField = textarea.closest(".message-input");

    expect(messageField).toBeTruthy();
    fireEvent.click(messageField as HTMLElement);

    expect(document.activeElement).toBe(textarea);
  });

  it("keeps the focused textarea enabled while a message is being sent", () => {
    const view = render(composer());
    const textarea = screen.getByRole("textbox", { name: "Zpráva" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ahoj" } });
    textarea.focus();

    view.rerender(composer({ sending: true }));

    expect(textarea.disabled).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect((screen.getByRole("button", { name: "Odeslat" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not erase a new draft typed while the previous send is completing", async () => {
    let finishSend: ((value: boolean) => void) | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSend = resolve;
        })
    );
    render(composer({ onSend }));
    const textarea = screen.getByRole("textbox", { name: "Zpráva" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ahoj" } });
    fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));
    fireEvent.change(textarea, { target: { value: "další zpráva" } });

    await act(async () => finishSend?.(true));

    expect(textarea.value).toBe("další zpráva");
  });

  it("keeps location actions under the plus menu instead of a permanent mobile row", () => {
    const onShareLocation = vi.fn();
    render(composer({ onShareLocation }));

    expect(screen.queryByRole("menuitem", { name: "Odeslat aktuální polohu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Přílohy a poloha" }));

    expect(screen.getByRole("menuitem", { name: "Fotografie" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Dokument nebo soubor" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sdílet živou polohu · 15 min" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Odeslat aktuální polohu" }));

    expect(onShareLocation).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem", { name: "Odeslat aktuální polohu" })).toBeNull();
  });

  it("places the jump-to-latest action inside the message field", () => {
    const onJumpToLatest = vi.fn();
    render(composer({ onJumpToLatest, showJumpToLatest: true }));
    const jumpButton = screen.getByRole("button", { name: "Přejít na konec chatu" });

    expect(jumpButton.closest(".message-input")).toBeTruthy();
    fireEvent.click(jumpButton);

    expect(onJumpToLatest).toHaveBeenCalledOnce();
  });
});
