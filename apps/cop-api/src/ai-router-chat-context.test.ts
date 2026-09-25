import { describe, expect, it } from "vitest";
import { reviewedInternalChatItems } from "./ai-router-chat-context.js";

describe("reviewed internal Router context", () => {
  it("selects bounded typed fields and drops attachments, ids and raw incident data", () => {
    const items = reviewedInternalChatItems({
      chatContext: { source: "browser-visible-decrypted-timeline", messages: [{ body: "Soukromá zpráva", senderDisplayName: "Operátor", token: "SECRET" }] },
      alerts: [{ title: "Výstraha", detail: "Situace vyžaduje ověření.", secret: "SECRET" }],
      communityReports: [{ title: "Hlášení", description: "Text hlášení", attachments: [{ body: "SECRET" }] }],
      mapResults: [{ label: "Mapa", coordinates: [50, 14] }],
      sourceHealth: [{ displayName: "Zdroj", status: "stale", credentials: "SECRET" }]
    });
    expect(items.map((item) => item.kind)).toEqual(["chat_message", "alert", "community_report", "map_result", "source_health"]);
    expect(JSON.stringify(items)).toContain("Soukromá zpráva");
    expect(JSON.stringify(items)).not.toContain("SECRET");
    expect(JSON.stringify(items)).not.toContain("coordinates");
    expect(JSON.stringify(items)).not.toContain("attachments");
  });
});
