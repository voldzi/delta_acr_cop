export type ChatLocale = "cs" | "en";

export type ChatTextKey =
  "calls.audioTitle" | "calls.audioUnavailable" | "calls.videoComingSoon" | "calls.videoTitle" | "dialog.loading";

const chatDictionaries: Record<ChatLocale, Record<ChatTextKey, string>> = {
  cs: {
    "calls.audioTitle": "Zahájit hlasový hovor",
    "calls.audioUnavailable": "Hlasový hovor lze zahájit jen v přímém chatu po připojení Matrix místnosti.",
    "calls.videoComingSoon": "Videohovory jsou v přípravě.",
    "calls.videoTitle": "Videohovor je v přípravě",
    "dialog.loading": "Načítám..."
  },
  en: {
    "calls.audioTitle": "Start voice call",
    "calls.audioUnavailable": "Voice calls can start only in a direct chat after the Matrix room is connected.",
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
