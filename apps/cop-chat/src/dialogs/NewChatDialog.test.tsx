// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserDirectoryEntry } from "@cop/core/cop-data";

import NewChatDialog from "./NewChatDialog";

function user(overrides: Partial<UserDirectoryEntry> = {}): UserDirectoryEntry {
  return {
    displayName: "COP Operator",
    email: "operator@example.test",
    subjectId: "operator-1",
    username: "cop.operator",
    ...overrides
  };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof NewChatDialog>> = {}) {
  return render(
    <NewChatDialog
      canChat
      directQuery=""
      directSuggestions={[]}
      memberQuery=""
      memberSuggestions={[]}
      mode="direct"
      newGroupName=""
      searchLoading={false}
      onAddMember={vi.fn()}
      onClose={vi.fn()}
      onCreateDirect={vi.fn()}
      onCreateGroup={vi.fn()}
      onDirectQueryChange={vi.fn()}
      onGroupNameChange={vi.fn()}
      onMemberQueryChange={vi.fn()}
      onModeChange={vi.fn()}
      {...overrides}
    />
  );
}

describe("NewChatDialog", () => {
  it("renders direct chat search and starts a direct chat from a suggestion", () => {
    const onCreateDirect = vi.fn();
    const onDirectQueryChange = vi.fn();
    renderDialog({
      directQuery: "cop",
      directSuggestions: [user()],
      onCreateDirect,
      onDirectQueryChange
    });

    expect(screen.getByRole("dialog", { name: "Nový chat" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Jméno, e-mail nebo login"), { target: { value: "operator" } });
    expect(onDirectQueryChange).toHaveBeenCalledWith("operator");

    fireEvent.click(screen.getByText("COP Operator"));
    expect(onCreateDirect).toHaveBeenCalledWith(expect.objectContaining({ subjectId: "operator-1" }));
  });

  it("switches from direct chat to group mode", () => {
    const onModeChange = vi.fn();
    renderDialog({ onModeChange });

    fireEvent.click(screen.getByRole("button", { name: "Nová skupina" }));
    expect(onModeChange).toHaveBeenCalledWith("group");
  });

  it("creates a group only after a group name is entered", () => {
    const onCreateGroup = vi.fn();
    const onGroupNameChange = vi.fn();
    const { rerender } = renderDialog({
      mode: "group",
      newGroupName: "",
      onCreateGroup,
      onGroupNameChange
    });

    const createButton = screen.getByRole("button", { name: "Vytvořit skupinu" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Název skupiny"), { target: { value: "Krizový tým" } });
    expect(onGroupNameChange).toHaveBeenCalledWith("Krizový tým");

    rerender(
      <NewChatDialog
        canChat
        directQuery=""
        directSuggestions={[]}
        memberQuery=""
        memberSuggestions={[]}
        mode="group"
        newGroupName="Krizový tým"
        searchLoading={false}
        onAddMember={vi.fn()}
        onClose={vi.fn()}
        onCreateDirect={vi.fn()}
        onCreateGroup={onCreateGroup}
        onDirectQueryChange={vi.fn()}
        onGroupNameChange={onGroupNameChange}
        onMemberQueryChange={vi.fn()}
        onModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Vytvořit skupinu" }));
    expect(onCreateGroup).toHaveBeenCalled();
  });

  it("adds a member from group member suggestions", () => {
    const onAddMember = vi.fn();
    const onMemberQueryChange = vi.fn();
    renderDialog({
      memberQuery: "cop",
      memberSuggestions: [user({ displayName: "Jiří Volek", subjectId: "user-2", username: "voldzi" })],
      mode: "group",
      newGroupName: "Skupina",
      onAddMember,
      onMemberQueryChange
    });

    fireEvent.change(screen.getByPlaceholderText("Přidat člena do vybrané skupiny"), { target: { value: "voldzi" } });
    expect(onMemberQueryChange).toHaveBeenCalledWith("voldzi");

    fireEvent.click(screen.getByText("Jiří Volek"));
    expect(onAddMember).toHaveBeenCalledWith(expect.objectContaining({ subjectId: "user-2" }));
  });

  it("opens a focused member-add dialog without group creation controls", () => {
    const onAddMember = vi.fn();
    const onMemberQueryChange = vi.fn();
    renderDialog({
      memberQuery: "vo",
      memberSuggestions: [user({ displayName: "Jiří Volek", subjectId: "user-2", username: "voldzi" })],
      mode: "member",
      onAddMember,
      onMemberQueryChange
    });

    expect(screen.getByRole("dialog", { name: "Přidat člena" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vytvořit skupinu" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Jméno, e-mail nebo login člena"), { target: { value: "voldzi" } });
    expect(onMemberQueryChange).toHaveBeenCalledWith("voldzi");

    fireEvent.click(screen.getByText("Jiří Volek"));
    expect(onAddMember).toHaveBeenCalledWith(expect.objectContaining({ subjectId: "user-2" }));
  });
});
