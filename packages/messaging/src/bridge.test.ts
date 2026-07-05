import { describe, expect, it } from "vitest";

import {
  chatBridgeChannelName,
  chatBridgeMessageTypes,
  chatUnreadStorageKey,
  decodeCopMapFocusSearch,
  decodeChatCenterLocation,
  decodeChatCurrentLocation,
  decodeChatSelect,
  decodeChatShareTransit,
  decodeChatUnread,
  encodeCopMapFocusUrl,
  encodeChatCenterLocation,
  encodeChatCurrentLocation,
  encodeChatSelect,
  encodeChatShareTransit,
  encodeChatUnread
} from "./bridge.js";

// Single source of truth for the cop-chat <-> cop-web wire contract. These tests
// pin the exact constants and payload shapes so both apps stay compatible.

describe("contract constants", () => {
  it("keeps the agreed message types, channel and storage key", () => {
    expect(chatBridgeMessageTypes).toEqual({
      centerLocation: "cop-chat:center-location",
      currentLocation: "cop-chat:current-location",
      select: "cop-chat:select",
      shareTransit: "cop-chat:share-transit",
      unread: "cop-chat:unread"
    });
    expect(chatBridgeChannelName).toBe("cop-chat");
    expect(chatUnreadStorageKey).toBe("cop.chat.unread.v1");
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
    expect(() => encodeChatCurrentLocation({ lat: Number.NaN, lon: 17 })).toThrow("Current location requires finite coordinates.");
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

describe("center-location (chat -> web)", () => {
  it("round-trips finite coordinates", () => {
    const payload = encodeChatCenterLocation(50.0755, 14.4378);
    expect(payload).toEqual({ lat: 50.0755, lon: 14.4378, type: "cop-chat:center-location" });
    expect(decodeChatCenterLocation(payload)).toEqual({ lat: 50.0755, lon: 14.4378, type: "cop-chat:center-location" });
  });

  it("round-trips optional map focus metadata", () => {
    const payload = encodeChatCenterLocation(50.1187, 17.3842, {
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

  it("rejects non-finite or foreign payloads", () => {
    expect(decodeChatCenterLocation({ lat: Number.NaN, lon: 1, type: "cop-chat:center-location" })).toBeNull();
    expect(decodeChatCenterLocation({ lat: 1, lon: 2, type: "other" })).toBeNull();
    expect(decodeChatCenterLocation(["cop-chat:center-location"])).toBeNull();
  });

  it("encodes and decodes COP map focus URLs for standalone chat", () => {
    const focus = encodeChatCenterLocation(50.1187, 17.3842, {
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
    expect(url).toContain("copLayerId=reference.infrastructure.emergency");
    expect(decodeCopMapFocusSearch(new URL(url).search)).toEqual(focus);
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
