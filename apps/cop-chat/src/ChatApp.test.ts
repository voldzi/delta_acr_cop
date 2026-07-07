import { describe, expect, it } from "vitest";

import { mergeTimelineMessages, timelineNeedsBridgeBackfill } from "./chat-model";
import {
  aiMapActionsForMessage,
  aiMapActionsFromResponse,
  aiQuestionNeedsCurrentLocation,
  buildAiChatContextSnapshot,
  buildAiRequestContextOptions,
  chatNotificationTag,
  collectIncomingChatNotifications,
  composerQuickActions,
  composerSuggestions,
  formatAiAgentShareBody,
  formatAiSituationShareBody,
  parseAiAgentInvocation,
  parseAiAgentMention
} from "./ChatApp";
import type { AiCopResponse } from "@cop/core/cop-data";
import type { MatrixRoomSummary, MatrixTimelineMessage } from "@cop/messaging/types";

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

describe("timelineNeedsBridgeBackfill", () => {
  const message = (eventId: string, timestamp: string): MatrixTimelineMessage => ({
    body: eventId,
    eventId,
    kind: "text",
    own: false,
    sender: "@peer:cop.local",
    timestamp
  });

  it("detects a cache/live gap that should trigger Matrix scrollback", () => {
    expect(
      timelineNeedsBridgeBackfill(
        [
          message("$cop-9", "2026-07-06T14:29:00.000Z"),
          message("$cop-14", "2026-07-07T13:13:00.000Z")
        ],
        [message("$cop-14", "2026-07-07T13:13:00.000Z")]
      )
    ).toBe(true);
  });

  it("does not request bridge backfill when the cached edge is close to live history", () => {
    expect(
      timelineNeedsBridgeBackfill(
        [
          message("$cop-9", "2026-07-06T14:29:00.000Z"),
          message("$cop-10", "2026-07-06T14:30:00.000Z"),
          message("$cop-14", "2026-07-06T14:33:00.000Z")
        ],
        [message("$cop-10", "2026-07-06T14:30:00.000Z"), message("$cop-14", "2026-07-06T14:33:00.000Z")]
      )
    ).toBe(false);
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

describe("parseAiAgentInvocation", () => {
  it("extracts slash commands with explicit model preferences", () => {
    expect(parseAiAgentInvocation("/ai shrň rizika")).toMatchObject({
      modelPreference: "fast",
      question: "shrň rizika",
      trigger: "slash"
    });
    expect(parseAiAgentInvocation("/reasoning vyhodnoť dopady")).toMatchObject({
      modelPreference: "reasoning",
      question: "vyhodnoť dopady",
      trigger: "slash"
    });
    expect(parseAiAgentInvocation("/ai /fast krátce stav zdrojů")).toMatchObject({
      modelPreference: "fast",
      question: "krátce stav zdrojů",
      trigger: "slash"
    });
  });

  it("uses mentions only when group AI is enabled", () => {
    expect(parseAiAgentInvocation("@AI stav?", { groupAiAssistantEnabled: true })).toMatchObject({
      modelPreference: "fast",
      question: "stav?",
      trigger: "mention"
    });
    expect(parseAiAgentInvocation("@AI stav?", { groupAiAssistantEnabled: false })).toBeNull();
  });

  it("treats normal messages as AI questions only inside the dedicated AI chat", () => {
    expect(parseAiAgentInvocation("Co je v okolí nejisté?", { aiDirectChat: true })).toMatchObject({
      modelPreference: "fast",
      question: "Co je v okolí nejisté?",
      trigger: "direct-ai-chat"
    });
    expect(parseAiAgentInvocation("Co je v okolí nejisté?")).toBeNull();
  });
});

describe("composerSuggestions", () => {
  it("suggests slash AI commands", () => {
    expect(composerSuggestions("/", true).map((item) => item.label)).toEqual(["/ai", "/fast", "/reasoning", "/tomato"]);
    expect(composerSuggestions("/r", true)).toMatchObject([{ label: "/reasoning", value: "/reasoning " }]);
    expect(composerSuggestions("/t", true)).toMatchObject([{ label: "/tomato", value: "/tomato" }]);
  });

  it("suggests AI mentions only when the agent is available", () => {
    expect(composerSuggestions("@", true).map((item) => item.label)).toEqual(["@COP AI", "@AI"]);
    expect(composerSuggestions("@", false)).toEqual([]);
  });
});

describe("composerQuickActions", () => {
  it("keeps AI actions visible when the agent is available", () => {
    expect(composerQuickActions(true).map((item) => item.label)).toEqual([
      "AI dotaz",
      "Rychle",
      "Reasoning",
      "Krizový přehled"
    ]);
    expect(composerQuickActions(false)).toEqual([]);
  });
});

describe("chatNotificationTag", () => {
  it("keeps repeated messages in one room from replacing each other", () => {
    expect(chatNotificationTag("!room:cop.local", "$event-1")).not.toBe(
      chatNotificationTag("!room:cop.local", "$event-2")
    );
  });
});

describe("collectIncomingChatNotifications", () => {
  const room: MatrixRoomSummary = {
    encrypted: true,
    name: "Operační skupina",
    roomId: "!ops:cop.local",
    unreadCount: 0
  };

  const tracker = () => ({
    notifiedEventIds: new Set<string>(),
    primedRoomIds: new Set<string>(),
    roomWatermarks: new Map<string, number>()
  });

  const incoming = (eventId: string, timestamp: string): MatrixTimelineMessage => ({
    body: "Zpráva",
    eventId,
    kind: "text",
    own: false,
    sender: "@peer:cop.local",
    timestamp
  });

  it("primes initial room history without replaying old notifications", () => {
    const state = tracker();
    const initialHistory = [incoming("$old", "2026-07-07T10:00:00.000Z")];

    expect(
      collectIncomingChatNotifications(
        [{ activeFocused: false, chat: null, messages: initialHistory, muted: false, room }],
        state,
        Date.parse("2026-07-07T10:05:00.000Z")
      )
    ).toEqual([]);

    expect(state.notifiedEventIds.has("$old")).toBe(true);
    expect(state.roomWatermarks.get(room.roomId)).toBe(Date.parse("2026-07-07T10:05:00.000Z"));
  });

  it("ignores older history backfilled after an empty room was primed", () => {
    const state = tracker();

    expect(
      collectIncomingChatNotifications(
        [{ activeFocused: false, chat: null, messages: [], muted: false, room }],
        state,
        Date.parse("2026-07-07T10:05:00.000Z")
      )
    ).toEqual([]);

    expect(
      collectIncomingChatNotifications(
        [{ activeFocused: false, chat: null, messages: [incoming("$backfill", "2026-07-07T10:04:00.000Z")], muted: false, room }],
        state,
        Date.parse("2026-07-07T10:06:00.000Z")
      )
    ).toEqual([]);
  });

  it("notifies only messages newer than the room watermark", () => {
    const state = tracker();
    collectIncomingChatNotifications(
      [{ activeFocused: false, chat: null, messages: [incoming("$old", "2026-07-07T10:00:00.000Z")], muted: false, room }],
      state,
      Date.parse("2026-07-07T10:05:00.000Z")
    );

    const fresh = incoming("$fresh", "2026-07-07T10:06:00.000Z");
    expect(
      collectIncomingChatNotifications(
        [
          {
            activeFocused: false,
            chat: null,
            messages: [incoming("$old", "2026-07-07T10:00:00.000Z"), fresh],
            muted: false,
            room
          }
        ],
        state,
        Date.parse("2026-07-07T10:06:01.000Z")
      )
    ).toEqual([{ chat: null, message: fresh, room }]);
  });
});

describe("AI share body formatters", () => {
  it("keeps a readable Matrix fallback for clients that ignore COP metadata", () => {
    expect(formatAiAgentShareBody("Odpověď", "Rizika?")).toBe("COP AI agent\nDotaz: Rizika?\n\nOdpověď");
    expect(formatAiSituationShareBody("Souhrn")).toBe("AI situační souhrn:\n\nSouhrn");
  });
});

describe("aiMapActionsFromResponse", () => {
  const baseResponse: AiCopResponse = {
    auditId: "audit-map",
    model: "gemma4:12b-mlx",
    policy: {
      allowed: true,
      reason: "ok",
      redactionsApplied: false
    },
    provider: "ollama",
    requestId: "request-map",
    result: {
      structured: {},
      summary: "Našel jsem policii."
    },
    status: "COMPLETED"
  };

  it("extracts explicit structured map actions", () => {
    expect(
      aiMapActionsFromResponse({
        ...baseResponse,
        result: {
          ...baseResponse.result,
          structured: {
            mapActions: [
              {
                action: "focus-map",
                entityId: "security-police:vrbno",
                label: "Zobrazit na mapě: Policie",
                layerId: "reference.infrastructure.emergency",
                lat: 50.1187,
                lon: 17.3842,
                sourceName: "SIM search-data",
                sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
                title: "Policie"
              },
              {
                action: "focus-map",
                label: "Neplatný bod",
                lat: "x",
                lon: 17.3842
              }
            ]
          }
        }
      })
    ).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "security-police:vrbno",
        label: "Zobrazit na mapě: Policie",
        layerId: "reference.infrastructure.emergency",
        lat: 50.1187,
        lon: 17.3842,
        sourceName: "SIM search-data",
        sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
        title: "Policie"
      })
    ]);
  });

  it("falls back to map search results when explicit actions are missing", () => {
    expect(
      aiMapActionsFromResponse({
        ...baseResponse,
        result: {
          ...baseResponse.result,
          structured: {
            mapSearch: {
              results: [
                {
                  distanceText: "1.2 km",
                  location: {
                    lat: 50.1187,
                    lon: 17.3842
                  },
                  layerId: "reference.infrastructure.emergency",
                  mapFeatureId: "security-police:vrbno",
                  sourceName: "SIM search-data",
                  sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
                  title: "Policie ČR - Vrbno pod Pradědem",
                  type: "mapFeature"
                }
              ]
            }
          }
        }
      })
    ).toEqual([
      expect.objectContaining({
        action: "focus-map",
        entityId: "security-police:vrbno",
        label: "Zobrazit na mapě: Policie ČR - Vrbno pod Pradědem (1.2 km)",
        layerId: "reference.infrastructure.emergency",
        lat: 50.1187,
        lon: 17.3842,
        sourceName: "SIM search-data",
        sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
        title: "Policie ČR - Vrbno pod Pradědem",
        zoom: 16
      })
    ]);
  });
});

describe("aiMapActionsForMessage", () => {
  it("derives a clickable map action from an older AI text fallback with coordinates", () => {
    const message: MatrixTimelineMessage = {
      body: [
        "COP AI agent",
        "Dotaz: Najdi nejbližší policejní stanici blízko mé polohy.",
        "",
        "Našel jsem v mapových datech COP: Policie ČR - Obvodní oddělení Vrbno pod Pradědem, 583, Nádražní, Mnichov, Železná, Vrbno pod Pradědem, okres Bruntál, Moravskoslezský kraj, 793 26, Česko. Kategorie: police. Vzdálenost od zadané polohy: 1.8 km. Souřadnice: 50.12076, 17.38413. Zdroj: COP mapové vyhledávání."
      ].join("\n"),
      cop: {
        ai: {
          question: "Najdi nejbližší policejní stanici blízko mé polohy.",
          status: "COMPLETED",
          type: "chat-agent"
        },
        kind: "ai-agent-response",
        source: "cop-chat"
      },
      eventId: "$ai-map",
      kind: "text",
      own: true,
      sender: "@me:cop.local",
      timestamp: "2026-07-05T14:54:00.000Z"
    };

    expect(aiMapActionsForMessage(message)).toEqual([
      expect.objectContaining({
        action: "focus-map",
        distanceText: "1.8 km",
        label: expect.stringContaining("Zobrazit na mapě"),
        lat: 50.12076,
        lon: 17.38413,
        title: expect.stringContaining("Policie ČR - Obvodní oddělení Vrbno pod Pradědem"),
        zoom: 16
      })
    ]);
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
      ...(index === 31
        ? {
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
          }
        : {})
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

describe("buildAiRequestContextOptions", () => {
  it("adds the latest shared location as AI geo context", () => {
    const messages: MatrixTimelineMessage[] = [
      {
        body: "Stará poloha",
        eventId: "$loc-1",
        kind: "location",
        location: {
          label: "Stará poloha",
          lat: 50.02,
          lon: 17.01,
          source: "map"
        },
        own: true,
        sender: "@me:cop.local",
        timestamp: "2026-06-26T07:45:00.000Z"
      },
      {
        body: "Text bez polohy",
        eventId: "$text",
        kind: "text",
        own: false,
        sender: "@peer:cop.local",
        timestamp: "2026-06-26T07:46:00.000Z"
      },
      {
        body: "Moje poloha",
        eventId: "$loc-2",
        kind: "location",
        location: {
          label: "Moje poloha",
          lat: 50.12952,
          lon: 17.36285,
          source: "device"
        },
        own: true,
        sender: "@me:cop.local",
        timestamp: "2026-06-26T07:47:00.000Z"
      }
    ];

    expect(buildAiRequestContextOptions(messages)).toEqual({
      geoContext: {
        currentLocation: {
          label: "Moje poloha",
          lat: 50.12952,
          lon: 17.36285,
          radiusKm: 30
        },
        label: "Moje poloha"
      },
      timeWindow: {
        maxAgeSeconds: 604800
      }
    });
  });

  it("prefers the host map current location over older chat location messages", () => {
    const messages: MatrixTimelineMessage[] = [
      {
        body: "Sdílená poloha v chatu",
        eventId: "$loc-chat",
        kind: "location",
        location: {
          label: "Starší poloha v chatu",
          lat: 49.9,
          lon: 14.5,
          source: "map"
        },
        own: true,
        sender: "@me:cop.local",
        timestamp: "2026-06-26T07:45:00.000Z"
      }
    ];

    expect(
      buildAiRequestContextOptions(messages, {
        label: "Moje poloha",
        lat: 50.12952,
        lon: 17.36285,
        source: "device"
      })
    ).toEqual({
      geoContext: {
        currentLocation: {
          label: "Moje poloha",
          lat: 50.12952,
          lon: 17.36285,
          radiusKm: 30
        },
        label: "Moje poloha"
      },
      timeWindow: {
        maxAgeSeconds: 604800
      }
    });
  });
});

describe("aiQuestionNeedsCurrentLocation", () => {
  it("detects nearest/current-location questions without triggering for explicit places", () => {
    expect(aiQuestionNeedsCurrentLocation("Najdi mi nejbližší policii od mé polohy.")).toBe(true);
    expect(aiQuestionNeedsCurrentLocation("Kde je nejbližší AED?")).toBe(true);
    expect(aiQuestionNeedsCurrentLocation("Kde se měří výška vody v okolí? a jaká je nyní hodnota?")).toBe(true);
    expect(aiQuestionNeedsCurrentLocation("Najdi policii ve Vrbně pod Pradědem.")).toBe(false);
    expect(aiQuestionNeedsCurrentLocation("Jaká je situace ve Vrbně pod Pradědem?")).toBe(false);
  });
});
