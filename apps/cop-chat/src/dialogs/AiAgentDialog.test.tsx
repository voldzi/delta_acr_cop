// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiCopResponse } from "@cop/core/cop-data";

import AiAgentDialog from "./AiAgentDialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
      routerPilotAnswer={null}
      routerPilotError={null}
      routerPilotWorking={false}
      sending={false}
      working={false}
      onAsk={vi.fn()}
      onRunRouterPilot={vi.fn()}
      onClose={vi.fn()}
      onModelPreferenceChange={vi.fn()}
      onQuestionChange={vi.fn()}
      onSendToChat={vi.fn()}
      {...overrides}
    />
  );
}

describe("AiAgentDialog", () => {
  it("shows own-key Global processing and hides model choice when BYOK routing is active", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          available: true,
          configured: true,
          provider: "openai",
          routingEnabled: true
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    renderDialog({ apiBase: "", authToken: "session-token" });
    expect(await screen.findByText(/OpenAI Global a účtuje se vašemu projektu/u)).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/ai/chat-agent/credential");
    expect(screen.getByText(/Chat používá váš klíč OpenAI/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Důkladně" })).toBeNull();
  });
  it("lets a signed-in user save a key without displaying it again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ available: true, configured: false, provider: "openai" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ available: true, configured: true, provider: "openai" }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const key = `sk-proj-${"a".repeat(40)}`;
    renderDialog({ apiBase: "http://localhost:4310", authToken: "session-token" });
    const summary = await screen.findByText(/Vlastní OpenAI účet/u);
    fireEvent.click(summary);
    const input = screen.getByLabelText("API klíč OpenAI") as HTMLInputElement;
    fireEvent.change(input, { target: { value: key } });
    fireEvent.click(screen.getByRole("button", { name: "Uložit klíč" }));
    await waitFor(() => expect(screen.getByText(/klíč uložen/u)).toBeTruthy());
    expect(input.value).toBe("");
    expect(screen.queryByText(key)).toBeNull();
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(key);
  });
  it("offers a separate exercise that does not use the typed question", () => {
    const onRunRouterPilot = vi.fn();
    renderDialog({ onRunRouterPilot, question: "Soukromý text v poli" });
    expect(screen.getByText(/Vaše otázka ani obsah chatu se neodesílají/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Spustit cvičný dotaz" }));
    expect(onRunRouterPilot).toHaveBeenCalledOnce();
  });

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

    expect(screen.getByRole("button", { name: "Stručně" }).className).toContain("active");
    fireEvent.click(screen.getByRole("button", { name: "Důkladně" }));
    expect(onModelPreferenceChange).toHaveBeenCalledWith("reasoning");
  });

  it("sends an agent answer to chat", () => {
    const onSendToChat = vi.fn();
    renderDialog({ onSendToChat, question: "Stav?", response: response() });

    expect(screen.getByText("Zdroje jsou online, ale část letových stop může mít zpoždění.")).toBeTruthy();
    expect(screen.getByText("33333333-3333-4333-8333-333333333333")).toBeTruthy();
    expect(screen.getByText("Zdrojové citace")).toBeTruthy();
    expect(screen.getByText("Další relevantní zdroje")).toBeTruthy();
    expect(screen.getByText("Technické podrobnosti")).toBeTruthy();
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
