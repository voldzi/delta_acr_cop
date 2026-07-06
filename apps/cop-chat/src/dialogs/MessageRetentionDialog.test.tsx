// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MessageRetentionDialog from "./MessageRetentionDialog";
import {
  messageRetentionLabel,
  messageRetentionShortLabel,
  normalizeMessageRetentionSeconds
} from "./messageRetention";

describe("MessageRetentionDialog", () => {
  it("selects an automatic deletion interval", () => {
    const onSelect = vi.fn();
    render(
      <MessageRetentionDialog
        currentSeconds={null}
        saving={false}
        title="Krizový tým"
        onClose={vi.fn()}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole("dialog", { name: "Automatické odstraňování zpráv Krizový tým" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /7 dní/u }));
    expect(onSelect).toHaveBeenCalledWith(604_800);
  });

  it("disables interval changes while saving", () => {
    render(
      <MessageRetentionDialog currentSeconds={86_400} saving title="Krizový tým" onClose={vi.fn()} onSelect={vi.fn()} />
    );

    expect((screen.getByRole("button", { name: /24 hodin/u }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Hotovo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps retention labels and normalization stable", () => {
    expect(normalizeMessageRetentionSeconds(86_400)).toBe(86_400);
    expect(normalizeMessageRetentionSeconds(42)).toBeNull();
    expect(messageRetentionLabel(7_776_000)).toBe("90 dní");
    expect(messageRetentionShortLabel(null)).toBe("Vyp.");
  });
});
