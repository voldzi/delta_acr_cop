export type ChatLocale = "cs" | "en";

export type ChatTextKey =
  "calls.audioComingSoon" | "calls.audioTitle" | "calls.videoComingSoon" | "calls.videoTitle" | "dialog.loading";

const chatDictionaries: Record<ChatLocale, Record<ChatTextKey, string>> = {
  cs: {
    "calls.audioComingSoon": "Hovory jsou v přípravě.",
    "calls.audioTitle": "Hovor je v přípravě",
    "calls.videoComingSoon": "Videohovory jsou v přípravě.",
    "calls.videoTitle": "Videohovor je v přípravě",
    "dialog.loading": "Načítám..."
  },
  en: {
    "calls.audioComingSoon": "Calls are in preparation.",
    "calls.audioTitle": "Call is in preparation",
    "calls.videoComingSoon": "Video calls are in preparation.",
    "calls.videoTitle": "Video call is in preparation",
    "dialog.loading": "Loading..."
  }
};

export function resolveChatLocale(language: string | undefined): ChatLocale {
  return language?.toLowerCase().startsWith("en") ? "en" : "cs";
}

export function chatText(
  key: ChatTextKey,
  locale: ChatLocale = resolveChatLocale(globalThis.navigator?.language)
): string {
  return chatDictionaries[locale][key] ?? chatDictionaries.cs[key];
}
