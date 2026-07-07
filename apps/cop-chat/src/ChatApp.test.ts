import { describe, expect, it } from "vitest";

import {
  mergeTimelineMessages,
  selectReadableTimelineMessagesForStorage,
  timelineNeedsBridgeBackfill
} from "./chat-model";
import {
  aiMapActionsAllowedByPlaybook,
  aiMapActionsForMessage,
  aiMapActionsFromResponse,
  aiQuestionNeedsCurrentLocation,
  buildAiChatContextSnapshot,
  buildAiRequestContextOptions,
  chatNotificationTag,
  collapseLiveLocationTimeline,
  collectActiveLiveLocations,
  collectIncomingChatNotifications,
  composerQuickActions,
  composerSuggestions,
  formatAiAgentShareBody,
  formatAiSituationShareBody,
  parseAiAgentInvocation,
  parseAiAgentMention,
  shouldOfferRouteForAiMapAction,
  shouldShowInAppChatNotification
} from "./ChatApp";
import type { AiCopResponse } from "@cop/core/cop-data";
import type { MatrixRoomSummary, MatrixTimelineMessage } from "@cop/messaging/types";

describe("mergeTimelineMessages", () => {
  const undecryptableBody = "Zprávu zatím nelze zobrazit. V tomto prohlížeči chybí šifrovací klíč pro starší zprávy.";
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

  it("keeps a previously decrypted event when a live Matrix refresh temporarily reports it as undecryptable", () => {
    const readableLocation: MatrixTimelineMessage = {
      body: "Moje poloha",
      eventId: "$location",
      kind: "location",
      location: { label: "Moje poloha", lat: 50.06883, lon: 14.31115, source: "device" },
      own: true,
      sender: "@voldzi:msg.zeleznalady.cz",
      timestamp: "2026-07-07T18:24:00.000Z"
    };
    const undecryptableRefresh: MatrixTimelineMessage = {
      body: undecryptableBody,
      decryptionState: "undecryptable",
      eventId: "$location",
      kind: "text",
      own: true,
      sender: "@voldzi:msg.zeleznalady.cz",
      timestamp: "2026-07-07T18:24:00.000Z"
    };

    expect(mergeTimelineMessages([readableLocation], [undecryptableRefresh])).toEqual([readableLocation]);
  });

  it("replaces an undecryptable cached event when Matrix later provides decrypted content", () => {
    const undecryptableCached: MatrixTimelineMessage = {
      body: undecryptableBody,
      decryptionState: "undecryptable",
      eventId: "$server-late",
      kind: "text",
      own: false,
      sender: "@peer:msg.zeleznalady.cz",
      timestamp: "2026-07-07T18:25:00.000Z"
    };
    const readableLive: MatrixTimelineMessage = {
      body: "Ahoj, už je vidět",
      eventId: "$server-late",
      kind: "text",
      own: false,
      sender: "@peer:msg.zeleznalady.cz",
      timestamp: "2026-07-07T18:25:00.000Z"
    };

    expect(mergeTimelineMessages([undecryptableCached], [readableLive])).toEqual([readableLive]);
  });

  it("persists only the last known readable message versions for local timeline recovery", () => {
    const readableLocation: MatrixTimelineMessage = {
      body: "COP Operator živě",
      eventId: "$location-readable",
      kind: "location",
      location: { label: "COP Operator živě", lat: 50.06883, lon: 14.31115, source: "device" },
      own: false,
      sender: "@operator:msg.zeleznalady.cz",
      timestamp: "2026-07-07T18:24:00.000Z"
    };
    const undecryptableOwnMessage: MatrixTimelineMessage = {
      body: undecryptableBody,
      decryptionState: "undecryptable",
      eventId: "$own-lost",
      kind: "text",
      own: true,
      sender: "@voldzi:msg.zeleznalady.cz",
      timestamp: "2026-07-07T18:25:00.000Z"
    };

    expect(selectReadableTimelineMessagesForStorage([readableLocation, undecryptableOwnMessage])).toEqual([
      readableLocation
    ]);
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
        [message("$cop-9", "2026-07-06T14:29:00.000Z"), message("$cop-14", "2026-07-07T13:13:00.000Z")],
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

describe("shouldShowInAppChatNotification", () => {
  it("does not show a second local notification when web push is registered and active", () => {
    expect(
      shouldShowInAppChatNotification({
        permission: "granted",
        registered: true,
        subscriptionActive: true
      })
    ).toBe(false);
  });

  it("treats a registered browser with unknown subscription state as owned by web push", () => {
    expect(
      shouldShowInAppChatNotification({
        permission: "granted",
        registered: true
      })
    ).toBe(false);
  });

  it("keeps local notifications available before web push registration", () => {
    expect(
      shouldShowInAppChatNotification({
        permission: "granted",
        registered: false,
        subscriptionActive: false
      })
    ).toBe(true);
  });

  it("does not show local notifications without browser permission", () => {
    expect(
      shouldShowInAppChatNotification({
        permission: "default",
        registered: false,
        subscriptionActive: false
      })
    ).toBe(false);
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
        [
          {
            activeFocused: false,
            chat: null,
            messages: [incoming("$backfill", "2026-07-07T10:04:00.000Z")],
            muted: false,
            room
          }
        ],
        state,
        Date.parse("2026-07-07T10:06:00.000Z")
      )
    ).toEqual([]);
  });

  it("notifies only messages newer than the room watermark", () => {
    const state = tracker();
    collectIncomingChatNotifications(
      [
        {
          activeFocused: false,
          chat: null,
          messages: [incoming("$old", "2026-07-07T10:00:00.000Z")],
          muted: false,
          room
        }
      ],
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

describe("shouldOfferRouteForAiMapAction", () => {
  it("does not offer route buttons for weather and radar map actions", () => {
    expect(
      shouldOfferRouteForAiMapAction({
        action: "focus-map",
        category: "weather_radar",
        label: "Zobrazit na mapě: ČHMÚ MERGE 1h precipitation",
        layerId: "public.weather.radar_precipitation",
        lat: 49.695,
        lon: 15.0682,
        sourceName: "chmi_weather_radar",
        title: "ČHMÚ MERGE 1h precipitation"
      })
    ).toBe(false);
  });

  it("keeps route buttons for navigable operational map actions", () => {
    expect(
      shouldOfferRouteForAiMapAction({
        action: "focus-map",
        category: "police",
        entityId: "security-police:vrbno",
        label: "Zobrazit na mapě: Policie",
        layerId: "reference.infrastructure.emergency",
        lat: 50.1187,
        lon: 17.3842,
        title: "Policie"
      })
    ).toBe(true);
  });

  it("uses response playbook actions before route heuristics", () => {
    const weatherAction = {
      action: "focus-map" as const,
      category: "weather_radar",
      label: "Zobrazit na mapě: ČHMÚ radar",
      lat: 49.695,
      lon: 15.0682,
      title: "ČHMÚ radar"
    };
    expect(
      shouldOfferRouteForAiMapAction(weatherAction, {
        allowedActions: ["focus-map", "route"],
        domain: "weather",
        intentId: "weather.radar.show"
      })
    ).toBe(true);
    expect(
      shouldOfferRouteForAiMapAction(weatherAction, {
        allowedActions: ["focus-map"],
        domain: "weather",
        forbiddenActions: ["route"],
        intentId: "weather.radar.show"
      })
    ).toBe(false);
  });
});

describe("aiMapActionsAllowedByPlaybook", () => {
  it("limits weather answers to one map action", () => {
    const actions = [
      { action: "focus-map" as const, label: "Radar", lat: 49.6, lon: 15.1 },
      { action: "focus-map" as const, label: "Forecast", lat: 49.7, lon: 15.2 },
      { action: "focus-map" as const, label: "Wind", lat: 49.8, lon: 15.3 }
    ];

    expect(
      aiMapActionsAllowedByPlaybook(actions, {
        allowedActions: ["focus-map"],
        domain: "weather",
        forbiddenActions: ["route"],
        intentId: "weather.rain.now"
      })
    ).toEqual([actions[0]]);
  });

  it("hides map actions when playbook does not allow focus-map", () => {
    expect(
      aiMapActionsAllowedByPlaybook([{ action: "focus-map", label: "Mapa", lat: 49.6, lon: 15.1 }], {
        allowedActions: ["open-chat"],
        domain: "chat",
        intentId: "chat.notification.status"
      })
    ).toEqual([]);
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

describe("live location timeline helpers", () => {
  const liveMessage = (
    eventId: string,
    timestamp: string,
    status: "ended" | "live" = "live"
  ): MatrixTimelineMessage => ({
    body: "Živá poloha",
    eventId,
    kind: "location",
    location: {
      accuracyM: 12,
      label: "Jiří živě",
      lat: eventId === "$live-2" ? 50.2 : 50.1,
      live: {
        expiresAt: "2099-07-07T12:30:00.000Z",
        shareId: "live-1",
        status,
        updatedAt: timestamp
      },
      lon: 14.4,
      source: "device",
      updatedAt: timestamp
    },
    own: false,
    sender: "@jiri:cop.local",
    senderDisplayName: "Jiří",
    timestamp
  });

  it("keeps only the newest message for a live location share", () => {
    const collapsed = collapseLiveLocationTimeline([
      liveMessage("$live-1", "2026-07-07T12:00:00.000Z"),
      {
        body: "běžná zpráva",
        eventId: "$text",
        kind: "text",
        own: false,
        sender: "@jiri:cop.local",
        timestamp: "2026-07-07T12:00:05.000Z"
      },
      liveMessage("$live-2", "2026-07-07T12:00:15.000Z")
    ]);

    expect(collapsed.map((message) => message.eventId)).toEqual(["$text", "$live-2"]);
  });

  it("returns active live locations for the host map and omits ended shares", () => {
    expect(collectActiveLiveLocations([liveMessage("$live-2", "2026-07-07T12:00:15.000Z")], "!room:cop.local")).toEqual(
      [
        {
          accuracyM: 12,
          expiresAt: "2099-07-07T12:30:00.000Z",
          label: "Jiří živě",
          lat: 50.2,
          lon: 14.4,
          roomId: "!room:cop.local",
          sender: "@jiri:cop.local",
          senderDisplayName: "Jiří",
          shareId: "live-1",
          status: "live",
          updatedAt: "2026-07-07T12:00:15.000Z"
        }
      ]
    );
    expect(collectActiveLiveLocations([liveMessage("$ended", "2026-07-07T12:01:00.000Z", "ended")], "!room")).toEqual(
      []
    );
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
