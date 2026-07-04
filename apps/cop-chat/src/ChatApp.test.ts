import { describe, expect, it } from "vitest";

import { mergeTimelineMessages } from "./chat-model";
import { formatAiAgentShareBody, formatAiSituationShareBody, parseAiAgentMention } from "./ChatApp";
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
