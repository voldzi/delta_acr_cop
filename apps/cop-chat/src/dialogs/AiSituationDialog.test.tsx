// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiCopResponse } from "@cop/core/cop-data";

import AiSituationDialog, { aiResponseSummary } from "./AiSituationDialog";

function response(overrides: Partial<AiCopResponse> = {}): AiCopResponse {
  return {
    auditId: "11111111-1111-4111-8111-111111111111",
    model: "mock-cop-assistant-v1",
    policy: {
      allowed: true,
      reason: "Allowed COP assistance request.",
      redactionsApplied: false
    },
    provider: "mock",
    requestId: "22222222-2222-4222-8222-222222222222",
    result: {
      summary: "Aktivní výstrahy jsou bez kritických konfliktů."
    },
    status: "COMPLETED",
    ...overrides
  };
}

describe("AiSituationDialog", () => {
  it("renders AI summary metadata and sends the summary to chat", () => {
    const onSendToChat = vi.fn();
    render(
      <AiSituationDialog
        response={response()}
        sending={false}
        working={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onSendToChat={onSendToChat}
      />
    );

    expect(screen.getByRole("dialog", { name: "AI situační souhrn" })).toBeTruthy();
    expect(screen.getByText("Aktivní výstrahy jsou bez kritických konfliktů.")).toBeTruthy();
    expect(screen.getByText("mock / mock-cop-assistant-v1")).toBeTruthy();
    expect(screen.getByText("11111111-1111-4111-8111-111111111111")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Odeslat do chatu/u }));
    expect(onSendToChat).toHaveBeenCalledWith("Aktivní výstrahy jsou bez kritických konfliktů.");
  });

  it("requests summary generation when no response exists", () => {
    const onRefresh = vi.fn();
    render(
      <AiSituationDialog
        response={null}
        sending={false}
        working={false}
        onClose={vi.fn()}
        onRefresh={onRefresh}
        onSendToChat={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Vygenerovat/u }));
    expect(onRefresh).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Odeslat do chatu/u }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("copies the summary to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <AiSituationDialog
        response={response()}
        sending={false}
        working={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onSendToChat={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Zkopírovat/u }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Aktivní výstrahy jsou bez kritických konfliktů."));
    expect(screen.getByRole("button", { name: /Zkopírováno/u })).toBeTruthy();
  });

  it("falls back to structured JSON when the provider does not return text", () => {
    expect(aiResponseSummary(response({ result: { structured: { ok: true } } }))).toContain("\"ok\": true");
  });
});
