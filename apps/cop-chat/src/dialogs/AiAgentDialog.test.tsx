// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiCopResponse } from "@cop/core/cop-data";

import AiAgentDialog from "./AiAgentDialog";

function response(overrides: Partial<AiCopResponse> = {}): AiCopResponse {
  return {
    auditId: "33333333-3333-4333-8333-333333333333",
    model: "mock-cop-assistant-v1",
    policy: {
      allowed: true,
      reason: "Allowed COP assistance request.",
      redactionsApplied: false
    },
    provider: "mock",
    requestId: "44444444-4444-4444-8444-444444444444",
    result: {
      structured: {
        evidence: {
          indexed: {
            citations: [
              {
                citationId: "I1",
                entityId: "report-1",
                entityType: "communityReport",
                label: "Stoupající hladina řeky",
                location: {
                  lat: 50.12,
                  lon: 17.36
                },
                updatedAt: "2026-07-04T09:20:00.000Z"
              }
            ],
            documentCount: 3,
            matchedDocumentCount: 1,
            status: "ok"
          },
          priority: {
            citations: [
              {
                citationId: "P1",
                entityId: "alert-1",
                entityType: "alert",
                label: "Povodňová bdělost"
              }
            ]
          },
          semantic: {
            citations: [
              {
                citationId: "S1",
                entityId: "incident-1",
                entityType: "incident",
                label: "Uzavřený most"
              }
            ],
            documentCount: 2,
            model: "bge-m3",
            status: "ok"
          }
        }
      },
      summary: "Zdroje jsou online, ale část letových stop může mít zpoždění."
    },
    status: "COMPLETED",
    ...overrides
  };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof AiAgentDialog>> = {}) {
  return render(
    <AiAgentDialog
      modelPreference="fast"
      question=""
      response={null}
      sending={false}
      working={false}
      onAsk={vi.fn()}
      onClose={vi.fn()}
      onModelPreferenceChange={vi.fn()}
      onQuestionChange={vi.fn()}
      onSendToChat={vi.fn()}
      {...overrides}
    />
  );
}

describe("AiAgentDialog", () => {
  it("captures a question and asks the agent", () => {
    const onAsk = vi.fn();
    const onQuestionChange = vi.fn();
    renderDialog({ onAsk, onQuestionChange, question: "Co je nejisté?" });

    expect(screen.getByRole("dialog", { name: "AI agent" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Co je teď/u), { target: { value: "Jaký je stav zdrojů?" } });
    expect(onQuestionChange).toHaveBeenCalledWith("Jaký je stav zdrojů?");

    fireEvent.click(screen.getByRole("button", { name: /Zeptat se/u }));
    expect(onAsk).toHaveBeenCalled();
  });

  it("selects the reasoning model preference", () => {
    const onModelPreferenceChange = vi.fn();
    renderDialog({ onModelPreferenceChange });

    expect(screen.getByRole("button", { name: "Rychlý" }).className).toContain("active");
    fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
    expect(onModelPreferenceChange).toHaveBeenCalledWith("reasoning");
  });

  it("sends an agent answer to chat", () => {
    const onSendToChat = vi.fn();
    renderDialog({ onSendToChat, question: "Stav?", response: response() });

    expect(screen.getByText("Zdroje jsou online, ale část letových stop může mít zpoždění.")).toBeTruthy();
    expect(screen.getByText("33333333-3333-4333-8333-333333333333")).toBeTruthy();
    expect(screen.getByText("Zdrojové citace")).toBeTruthy();
    expect(screen.getByText("Background index")).toBeTruthy();
    expect(screen.getByText("Stoupající hladina řeky")).toBeTruthy();

    const dialog = screen.getByRole("dialog", { name: "AI agent" });
    const scrollBody = dialog.querySelector(".ai-dialog-body");
    expect(scrollBody?.contains(screen.getByPlaceholderText(/Co je teď/u))).toBe(true);
    expect(scrollBody?.contains(screen.getByText("Zdrojové citace"))).toBe(true);
    expect(scrollBody?.contains(screen.getByRole("button", { name: /Odeslat odpověď/u }))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Odeslat odpověď/u }));
    expect(onSendToChat).toHaveBeenCalledWith("Zdroje jsou online, ale část letových stop může mít zpoždění.");
  });

  it("disables actions while no question or answer is available", () => {
    renderDialog();

    expect((screen.getByRole("button", { name: /Zeptat se/u }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Odeslat odpověď/u }) as HTMLButtonElement).disabled).toBe(true);
  });
});
