// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ForwardDialog, { type ForwardTarget } from "./ForwardDialog";

function target(overrides: Partial<ForwardTarget> = {}): ForwardTarget {
  return {
    key: "chat:1",
    subtitle: "přímý chat",
    title: "COP Operator",
    type: "chat",
    ...overrides
  };
}

describe("ForwardDialog", () => {
  it("shows selected target count and forwards to multiple recipients", () => {
    const onSend = vi.fn();
    const onToggleTarget = vi.fn();
    render(
      <ForwardDialog
        draftCount={2}
        query=""
        searchLoading={false}
        selectedCount={2}
        selectedKeys={new Set(["chat:1", "chat:2"])}
        targets={[target(), target({ key: "chat:2", subtitle: "skupina", title: "DEMO Povodeň" })]}
        workingId={null}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onSend={onSend}
        onToggleTarget={onToggleTarget}
      />
    );

    expect(screen.getByText("2 zpráv")).toBeTruthy();
    expect(screen.getByText("Vybráno 2")).toBeTruthy();

    fireEvent.click(screen.getByText("DEMO Povodeň"));
    expect(onToggleTarget).toHaveBeenCalledWith(expect.objectContaining({ key: "chat:2" }));

    fireEvent.click(screen.getByRole("button", { name: /Odeslat/u }));
    expect(onSend).toHaveBeenCalled();
  });

  it("keeps send disabled until a recipient is selected", () => {
    render(
      <ForwardDialog
        draftCount={1}
        query=""
        searchLoading={false}
        selectedCount={0}
        selectedKeys={new Set()}
        targets={[target()]}
        workingId={null}
        onClose={vi.fn()}
        onQueryChange={vi.fn()}
        onSend={vi.fn()}
        onToggleTarget={vi.fn()}
      />
    );

    expect(screen.getByText("1 zpráva")).toBeTruthy();
    expect(screen.getByText("Vyberte příjemce")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Odeslat/u }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports search query changes and an empty result state", () => {
    const onQueryChange = vi.fn();
    render(
      <ForwardDialog
        draftCount={1}
        query="nikdo"
        searchLoading={false}
        selectedCount={0}
        selectedKeys={new Set()}
        targets={[]}
        workingId={null}
        onClose={vi.fn()}
        onQueryChange={onQueryChange}
        onSend={vi.fn()}
        onToggleTarget={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Hledat chat nebo osobu"), { target: { value: "operator" } });
    expect(onQueryChange).toHaveBeenCalledWith("operator");
    expect(screen.getByText("Žádný chat ani osoba neodpovídá hledání.")).toBeTruthy();
  });
});
