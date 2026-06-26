import { describe, expect, it } from "vitest";

import { mergeTimelineMessages } from "./ChatApp";
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
