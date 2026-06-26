import { describe, expect, it } from "vitest";

import { chatText, resolveChatLocale } from "./i18n";

describe("chat i18n", () => {
  it("defaults to Czech and supports English as the first non-Czech locale", () => {
    expect(resolveChatLocale("cs-CZ")).toBe("cs");
    expect(resolveChatLocale("en-US")).toBe("en");
    expect(resolveChatLocale(undefined)).toBe("cs");
  });

  it("returns translated chat labels", () => {
    expect(chatText("calls.videoTitle", "cs")).toBe("Videohovor je v přípravě");
    expect(chatText("calls.videoTitle", "en")).toBe("Video call is in preparation");
  });
});
