// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RemoveMemberDialog from "./RemoveMemberDialog";

describe("RemoveMemberDialog", () => {
  it("confirms removing a group member", () => {
    const onRemove = vi.fn();
    render(
      <RemoveMemberDialog
        groupName="Povodňový tým"
        memberName="Terénní hlídka"
        onClose={vi.fn()}
        onRemove={onRemove}
      />
    );

    expect(screen.getByRole("dialog", { name: "Odebrat člena Terénní hlídka" })).toBeTruthy();
    expect(screen.getByText(/Přestane být aktivním členem COP skupiny/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Odebrat člena" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("closes without removing", () => {
    const onClose = vi.fn();
    const onRemove = vi.fn();
    render(
      <RemoveMemberDialog
        groupName="Povodňový tým"
        memberName="Terénní hlídka"
        onClose={onClose}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Zrušit" }));
    expect(onClose).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
