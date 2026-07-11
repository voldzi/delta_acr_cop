import { describe, expect, it } from "vitest";

import {
  chatBridgeChannelName,
  chatBridgeMessageTypes,
  chatUnreadStorageKey,
  chatVoiceCallStorageKey,
  decodeCopReportDraftSearch,
  decodeCopMapFocusSearch,
  decodeChatCenterLocation,
  decodeChatCurrentLocation,
  decodeChatLiveLocations,
  decodeChatReportDraft,
  decodeChatSelect,
  decodeChatShareTransit,
  decodeChatSummary,
  decodeChatUnread,
  decodeChatVoiceCall,
  decodeChatVoiceCallCommand,
  decodeChatVoiceCallCommandAcknowledgement,
  encodeCopMapFocusUrl,
  encodeCopReportDraftUrl,
  encodeChatCenterLocation,
  encodeChatCurrentLocation,
  encodeChatLiveLocations,
  encodeChatReportDraft,
  encodeChatSelect,
  encodeChatShareTransit,
  encodeChatSummary,
  encodeChatUnread,
  encodeChatVoiceCall,
  encodeChatVoiceCallCommand,
  encodeChatVoiceCallCommandAcknowledgement
} from "./bridge.js";

// Single source of truth for the cop-chat <-> cop-web wire contract. These tests
// pin the exact constants and payload shapes so both apps stay compatible.

describe("contract constants", () => {
  it("keeps the agreed message types, channel and storage key", () => {
    expect(chatBridgeMessageTypes).toEqual({
      centerLocation: "cop-chat:center-location",
      currentLocation: "cop-chat:current-location",
      liveLocations: "cop-chat:live-locations",
      reportDraft: "cop-chat:report-draft",
      select: "cop-chat:select",
      shareTransit: "cop-chat:share-transit",
      summary: "cop-chat:summary",
      unread: "cop-chat:unread",
      voiceCall: "cop-chat:voice-call",
      voiceCallCommand: "cop-chat:voice-call-command",
      voiceCallCommandAcknowledgement: "cop-chat:voice-call-command-ack"
    });
    expect(chatBridgeChannelName).toBe("cop-chat");
    expect(chatUnreadStorageKey).toBe("cop.chat.unread.v1");
    expect(chatVoiceCallStorageKey).toBe("cop.chat.voiceCall.v1");
  });
});

describe("report-draft (chat -> web)", () => {
  it("round-trips sanitized conversation context without message content", () => {
    const payload = encodeChatReportDraft({
      conversationId: " conv-1 ",
      groupId: " group-1 ",
      roomId: " !room:example.cz ",
      title: " Povodeň v okolí "
    });

    expect(payload).toEqual({
      report: {
        conversationId: "conv-1",
        groupId: "group-1",
        roomId: "!room:example.cz",
        title: "Povodeň v okolí"
      },
      type: "cop-chat:report-draft"
    });
    expect(decodeChatReportDraft(payload)).toEqual(payload.report);
    expect(JSON.stringify(payload)).not.toContain("message");
  });

  it("encodes standalone report URLs and rejects empty contexts", () => {
    const url = encodeCopReportDraftUrl("https://cop.example.test/", {
      roomId: "!room:example.cz",
      title: "Okolí"
    });

    expect(decodeCopReportDraftSearch(new URL(url).search)).toEqual({
      roomId: "!room:example.cz",
      title: "Okolí"
    });
    expect(decodeCopReportDraftSearch("?copReport=0&copReportRoomId=x")).toBeNull();
    expect(() => encodeChatReportDraft({ title: "Bez kontextu" })).toThrow(
      "Chat report draft requires conversation context."
    );
  });
});

describe("live-locations (chat -> web)", () => {
  it("encodes and decodes active live location snapshots", () => {
    const payload = encodeChatLiveLocations([
      {
        accuracyM: 18.4,
        expiresAt: "2026-07-07T12:30:00.000Z",
        label: " Jiří Volek ",
        lat: 50.12952,
        lon: 17.36285,
        roomId: "!room:example.cz",
        sender: "@jiri:example.cz",
        senderDisplayName: " Jiří Volek ",
        shareId: " live-123 ",
        status: "live",
        updatedAt: "2026-07-07T12:15:00.000Z"
      }
    ]);

    expect(payload.type).toBe("cop-chat:live-locations");
    expect(decodeChatLiveLocations(payload)).toEqual([
      {
        accuracyM: 18.4,
        expiresAt: "2026-07-07T12:30:00.000Z",
        label: "Jiří Volek",
        lat: 50.12952,
        lon: 17.36285,
        roomId: "!room:example.cz",
        sender: "@jiri:example.cz",
        senderDisplayName: "Jiří Volek",
        shareId: "live-123",
        status: "live",
        updatedAt: "2026-07-07T12:15:00.000Z"
      }
    ]);
  });

  it("rejects malformed or foreign live location payloads", () => {
    expect(decodeChatLiveLocations({ locations: [], type: "other" })).toBeNull();
    expect(decodeChatLiveLocations({ locations: [{ lat: 91, lon: 17 }], type: "cop-chat:live-locations" })).toEqual([]);
  });
});

describe("current-location (web -> chat)", () => {
  it("encodes and decodes host location for AI geo context", () => {
    const payload = encodeChatCurrentLocation({
      accuracyM: 14.2,
      label: " Moje poloha ",
      lat: 50.12952,
      lon: 17.36285,
      source: "device",
      updatedAt: "2026-07-05T08:30:00.000Z"
    });

    expect(payload).toEqual({
      location: {
        accuracyM: 14.2,
        label: "Moje poloha",
        lat: 50.12952,
        lon: 17.36285,
        source: "device",
        updatedAt: "2026-07-05T08:30:00.000Z"
      },
      type: "cop-chat:current-location"
    });
    expect(decodeChatCurrentLocation(payload)).toEqual(payload.location);
  });

  it("rejects malformed current locations", () => {
    expect(() => encodeChatCurrentLocation({ lat: Number.NaN, lon: 17 })).toThrow(
      "Current location requires finite coordinates."
    );
    expect(decodeChatCurrentLocation({ location: { lat: 91, lon: 17 }, type: "cop-chat:current-location" })).toBeNull();
    expect(decodeChatCurrentLocation({ location: { lat: 50, lon: 17 }, type: "other" })).toBeNull();
  });
});

describe("share-transit (web -> chat)", () => {
  it("encodes and decodes a sanitized transit share payload", () => {
    const payload = encodeChatShareTransit({
      destination: "BŘEZINĚVES",
      featureId: "transit:pid:103:8096",
      label: "Autobus 103",
      lat: 50.166,
      lon: 14.476,
      nextStopName: "Štěpničná",
      routeShortName: "103",
      status: "on_time",
      warnings: ["  data jsou modelová  ", ""]
    });
    expect(payload.type).toBe("cop-chat:share-transit");
    expect(decodeChatShareTransit(payload)).toEqual({
      destination: "BŘEZINĚVES",
      featureId: "transit:pid:103:8096",
      label: "Autobus 103",
      lat: 50.166,
      lon: 14.476,
      nextStopName: "Štěpničná",
      routeShortName: "103",
      status: "on_time",
      warnings: ["data jsou modelová"]
    });
  });

  it("rejects malformed or foreign transit payloads", () => {
    expect(() => encodeChatShareTransit({ featureId: "" })).toThrow("Transit share requires featureId.");
    expect(decodeChatShareTransit({ transit: { featureId: "x" }, type: "other" })).toBeNull();
    expect(decodeChatShareTransit({ transit: {}, type: "cop-chat:share-transit" })).toBeNull();
  });
});

describe("unread (chat -> web)", () => {
  it("encodes a clamped integer count under the unread type", () => {
    const payload = encodeChatUnread(3.9);
    expect(payload.type).toBe("cop-chat:unread");
    expect(payload.count).toBe(3);
    expect(typeof payload.at).toBe("number");
    expect(encodeChatUnread(-5).count).toBe(0);
  });

  it("decodes valid payloads and rejects foreign ones", () => {
    expect(decodeChatUnread({ count: 4, type: "cop-chat:unread" })).toBe(4);
    expect(decodeChatUnread({ count: -2, type: "cop-chat:unread" })).toBe(0);
    expect(decodeChatUnread({ count: "4", type: "cop-chat:unread" })).toBeNull();
    expect(decodeChatUnread({ count: 4, type: "other" })).toBeNull();
    expect(decodeChatUnread(null)).toBeNull();
  });
});

describe("summary (chat -> web)", () => {
  it("encodes a compact unread-room snapshot", () => {
    const payload = encodeChatSummary({
      syncState: "ready",
      totalUnread: 2.9,
      unreadRooms: [
        {
          preview: "  Poslední zpráva  ",
          roomId: "!ops:example.cz",
          selection: " !ops:example.cz ",
          timestamp: "13:40",
          title: " Povodeň ",
          type: "group",
          unreadCount: 2.9
        }
      ]
    });
    expect(payload.type).toBe("cop-chat:summary");
    expect(payload.totalUnread).toBe(2);
    expect(payload.unreadRooms).toEqual([
      {
        preview: "Poslední zpráva",
        roomId: "!ops:example.cz",
        selection: "!ops:example.cz",
        timestamp: "13:40",
        title: "Povodeň",
        type: "group",
        unreadCount: 2
      }
    ]);
    expect(decodeChatSummary(payload)).toMatchObject({
      syncState: "ready",
      totalUnread: 2,
      type: "cop-chat:summary"
    });
  });

  it("rejects foreign summaries and drops malformed rooms", () => {
    expect(decodeChatSummary({ totalUnread: 2, type: "other" })).toBeNull();
    expect(
      decodeChatSummary({
        totalUnread: 1,
        type: "cop-chat:summary",
        unreadRooms: [
          { selection: "x", title: "", unreadCount: 1 },
          { selection: "y", title: "Y", unreadCount: 1 }
        ]
      })?.unreadRooms
    ).toEqual([{ selection: "y", title: "Y", unreadCount: 1 }]);
  });
});

describe("voice-call (chat -> web)", () => {
  it("encodes a compact voice-call state snapshot", () => {
    const payload = encodeChatVoiceCall({
      callId: " call-1 ",
      direction: "incoming",
      phase: "ringing",
      roomId: " !ops:example.cz ",
      title: " COP Operator "
    });

    expect(payload).toMatchObject({
      callId: "call-1",
      direction: "incoming",
      phase: "ringing",
      roomId: "!ops:example.cz",
      title: "COP Operator",
      type: "cop-chat:voice-call"
    });
    expect(typeof payload.at).toBe("number");
    expect(decodeChatVoiceCall(payload)).toEqual(payload);
  });

  it("rejects malformed or foreign voice-call payloads", () => {
    expect(() => encodeChatVoiceCall({ callId: "", direction: "incoming", phase: "ringing", roomId: "!ops" })).toThrow(
      "Voice call bridge payload requires callId, roomId, direction and phase."
    );
    expect(
      decodeChatVoiceCall({ callId: "call-1", direction: "incoming", phase: "ringing", roomId: "!ops", type: "other" })
    ).toBeNull();
    expect(
      decodeChatVoiceCall({
        callId: "call-1",
        direction: "sideways",
        phase: "ringing",
        roomId: "!ops",
        type: "cop-chat:voice-call"
      })
    ).toBeNull();
  });
});

describe("voice-call-command (web -> chat)", () => {
  it("encodes host voice-call commands", () => {
    const payload = encodeChatVoiceCallCommand({
      action: "answer",
      callId: " call-1 ",
      roomId: " !ops:example.cz "
    });

    expect(payload).toEqual({
      action: "answer",
      callId: "call-1",
      roomId: "!ops:example.cz",
      type: "cop-chat:voice-call-command"
    });
    expect(decodeChatVoiceCallCommand(payload)).toEqual(payload);
    expect(decodeChatVoiceCallCommand({ ...payload, action: "hangup" })).toEqual({ ...payload, action: "hangup" });
    expect(decodeChatVoiceCallCommand({ ...payload, action: "mute", muted: true })).toEqual({
      ...payload,
      action: "mute",
      muted: true
    });
  });

  it("round-trips a stable native action id and its acknowledgement", () => {
    const command = encodeChatVoiceCallCommand({
      action: "answer",
      actionId: "10000000-0000-4000-8000-000000000001",
      callId: "call-1",
      roomId: "!ops:example.cz"
    });
    expect(decodeChatVoiceCallCommand(command)).toEqual(command);

    const acknowledgement = encodeChatVoiceCallCommandAcknowledgement({
      actionId: "10000000-0000-4000-8000-000000000001",
      callId: "call-1",
      roomId: "!ops:example.cz",
      status: "succeeded"
    });
    expect(acknowledgement).toEqual({
      actionId: "10000000-0000-4000-8000-000000000001",
      callId: "call-1",
      roomId: "!ops:example.cz",
      status: "succeeded",
      type: "cop-chat:voice-call-command-ack"
    });
    expect(decodeChatVoiceCallCommandAcknowledgement(acknowledgement)).toEqual(acknowledgement);
    expect(decodeChatVoiceCallCommandAcknowledgement({ ...acknowledgement, status: "pending" })).toBeNull();
  });

  it("rejects malformed host voice-call commands", () => {
    expect(() => encodeChatVoiceCallCommand({ action: "answer", callId: "", roomId: "!ops" })).toThrow(
      "Voice call command requires action, callId and roomId."
    );
    expect(
      decodeChatVoiceCallCommand({
        action: "transfer",
        callId: "call-1",
        roomId: "!ops",
        type: "cop-chat:voice-call-command"
      })
    ).toBeNull();
  });
});

describe("center-location (chat -> web)", () => {
  it("round-trips finite coordinates", () => {
    const payload = encodeChatCenterLocation(50.0755, 14.4378);
    expect(payload).toEqual({ lat: 50.0755, lon: 14.4378, type: "cop-chat:center-location" });
    expect(decodeChatCenterLocation(payload)).toEqual({ lat: 50.0755, lon: 14.4378, type: "cop-chat:center-location" });
  });

  it("round-trips optional map focus metadata", () => {
    const payload = encodeChatCenterLocation(50.1187, 17.3842, {
      action: "route",
      category: " police ",
      featureId: " security-police:vrbno ",
      featureKind: "feature",
      label: " Policie ČR - Vrbno ",
      layerId: " reference.infrastructure.emergency ",
      sourceName: " SIM search-data ",
      sourceSystemIds: [" sim.search-data ", "reference.infrastructure.emergency", ""],
      zoom: 16
    });

    expect(payload).toEqual({
      action: "route",
      category: "police",
      featureId: "security-police:vrbno",
      featureKind: "feature",
      label: "Policie ČR - Vrbno",
      layerId: "reference.infrastructure.emergency",
      lat: 50.1187,
      lon: 17.3842,
      sourceName: "SIM search-data",
      sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
      type: "cop-chat:center-location",
      zoom: 16
    });
    expect(decodeChatCenterLocation(payload)).toEqual(payload);
  });

  it("rejects invalid coordinates or foreign payloads", () => {
    expect(() => encodeChatCenterLocation(91, 17)).toThrow("COP map focus requires finite coordinates.");
    expect(decodeChatCenterLocation({ lat: Number.NaN, lon: 1, type: "cop-chat:center-location" })).toBeNull();
    expect(decodeChatCenterLocation({ lat: 91, lon: 17, type: "cop-chat:center-location" })).toBeNull();
    expect(decodeChatCenterLocation({ lat: 50, lon: 181, type: "cop-chat:center-location" })).toBeNull();
    expect(decodeChatCenterLocation({ lat: 1, lon: 2, type: "other" })).toBeNull();
    expect(decodeChatCenterLocation(["cop-chat:center-location"])).toBeNull();
  });

  it("encodes and decodes COP map focus URLs for standalone chat", () => {
    const focus = encodeChatCenterLocation(50.1187, 17.3842, {
      action: "route",
      category: "police",
      featureId: "security-police:vrbno",
      featureKind: "feature",
      label: "Policie ČR - Vrbno",
      layerId: "reference.infrastructure.emergency",
      sourceName: "SIM search-data",
      sourceSystemIds: ["sim.search-data", "reference.infrastructure.emergency"],
      zoom: 16
    });
    const url = encodeCopMapFocusUrl("https://cop.zeleznalady.cz/", focus);

    expect(url).toContain("copLat=50.1187");
    expect(url).toContain("copLon=17.3842");
    expect(url).toContain("copAction=route");
    expect(url).toContain("copLayerId=reference.infrastructure.emergency");
    expect(decodeCopMapFocusSearch(new URL(url).search)).toEqual(focus);
  });

  it("does not treat an empty COP map focus URL as Null Island", () => {
    expect(decodeCopMapFocusSearch("")).toBeNull();
    expect(decodeCopMapFocusSearch("?copLat=50.1187")).toBeNull();
    expect(decodeCopMapFocusSearch("?copLon=17.3842")).toBeNull();
    expect(decodeCopMapFocusSearch("?copLat=0&copLon=0")).toBeNull();
  });
});

describe("select (web -> chat)", () => {
  it("encodes and trims a selection, rejecting empty or foreign payloads", () => {
    expect(encodeChatSelect("room-1")).toEqual({ selection: "room-1", type: "cop-chat:select" });
    expect(decodeChatSelect({ selection: "  room-1  ", type: "cop-chat:select" })).toBe("room-1");
    expect(decodeChatSelect({ selection: "   ", type: "cop-chat:select" })).toBeNull();
    expect(decodeChatSelect({ selection: "x", type: "other" })).toBeNull();
    expect(decodeChatSelect(null)).toBeNull();
  });
});
