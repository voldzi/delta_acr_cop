import { describe, expect, it } from "vitest";

import { mergeTimelineMessages } from "./chat-model";
import { buildAiChatContextSnapshot, formatAiAgentShareBody, formatAiSituationShareBody, parseAiAgentMention } from "./ChatApp";
import type { MatrixTimelineMessage } from "@cop/messaging/types";

describe("mergeTimelineMessages", () => {
  const baseMessage: MatrixTimelineMessage = {
    body: "text, který má být jenom jedenkrát",
    eventId: "$server",
    kind: "text",
    own: true,
    sender: "@voldzi:msg.zeleznalady.cz",
    timestamp: "2026-06-26T07:46:00.000Z"
  };

  it("replaces a local Matrix echo with the confirmed server event", () => {
    const localEcho: MatrixTimelineMessage = {
      ...baseMessage,
      eventId: "~local-echo",
      timestamp: "2026-06-26T07:45:59.500Z"
    };

    expect(mergeTimelineMessages([localEcho], [baseMessage])).toEqual([baseMessage]);
  });

  it("keeps intentionally repeated confirmed messages", () => {
    const repeatedMessage: MatrixTimelineMessage = {
      ...baseMessage,
      eventId: "$server-2",
      timestamp: "2026-06-26T07:46:03.000Z"
    };

    expect(mergeTimelineMessages([baseMessage], [repeatedMessage])).toEqual([baseMessage, repeatedMessage]);
  });
});

describe("parseAiAgentMention", () => {
  it("extracts a COP AI question from the beginning of a draft", () => {
    expect(parseAiAgentMention("@COP AI co je největší riziko?")).toBe("co je největší riziko?");
    expect(parseAiAgentMention(" @cop-ai: shrň situaci")).toBe("shrň situaci");
  });

  it("ignores normal messages and mentions later in the text", () => {
    expect(parseAiAgentMention("Ahoj @COP AI")).toBeNull();
    expect(parseAiAgentMention("COP AI bez zavináče")).toBeNull();
  });
});

describe("AI share body formatters", () => {
  it("keeps a readable Matrix fallback for clients that ignore COP metadata", () => {
    expect(formatAiAgentShareBody("Odpověď", "Rizika?")).toBe("COP AI agent\nDotaz: Rizika?\n\nOdpověď");
    expect(formatAiSituationShareBody("Souhrn")).toBe("AI situační souhrn:\n\nSouhrn");
  });
});

describe("buildAiChatContextSnapshot", () => {
  it("sends a bounded visible timeline snapshot with AI audit metadata", () => {
    const messages: MatrixTimelineMessage[] = Array.from({ length: 32 }, (_, index) => ({
      body: `Zpráva ${index}`,
      eventId: `$event-${index}`,
      kind: "text",
      own: index % 2 === 0,
      sender: index % 2 === 0 ? "@me:cop.local" : "@peer:cop.local",
      senderDisplayName: index % 2 === 0 ? "Já" : "Peer",
      timestamp: `2026-06-26T07:${String(index).padStart(2, "0")}:00.000Z`,
      ...(index === 31 ? {
        cop: {
          ai: {
            auditId: "audit-31",
            provider: "mock",
            status: "COMPLETED",
            type: "chat-agent"
          },
          kind: "ai-agent-response",
          source: "cop-chat"
        }
      } : {})
    }));

    const snapshot = buildAiChatContextSnapshot(messages, {
      currentUserMessage: "@COP AI shrň rizika",
      encrypted: true,
      roomId: "!room:cop.local"
    });

    expect(snapshot).toMatchObject({
      encrypted: true,
      includedMessageCount: 30,
      roomId: "!room:cop.local",
      source: "browser-visible-decrypted-timeline",
      visibleMessageCount: 33
    });
    expect(snapshot.messages?.[0]?.eventId).toBe("$event-3");
    expect(snapshot.messages?.at(-2)?.ai).toMatchObject({ auditId: "audit-31", provider: "mock" });
    expect(snapshot.messages?.at(-1)).toMatchObject({
      body: "@COP AI shrň rizika",
      eventId: "local:current-ai-question",
      own: true
    });
  });
});
