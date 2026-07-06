export type MessageRetentionSeconds = 86_400 | 604_800 | 7_776_000 | null;

export const messageRetentionOptions: Array<{ description: string; label: string; seconds: MessageRetentionSeconds }> =
  [
    { description: "Nové zprávy zmizí po jednom dni.", label: "24 hodin", seconds: 86_400 },
    { description: "Běžná pracovní doba uchování.", label: "7 dní", seconds: 604_800 },
    { description: "Dlouhodobější provozní historie.", label: "90 dní", seconds: 7_776_000 },
    { description: "Zprávy se nemažou automaticky.", label: "Vypnuto", seconds: null }
  ];

export function normalizeMessageRetentionSeconds(value: unknown): MessageRetentionSeconds {
  if (value === 86_400 || value === 604_800 || value === 7_776_000) {
    return value;
  }
  return null;
}

export function messageRetentionLabel(seconds: MessageRetentionSeconds): string {
  return messageRetentionOptions.find((option) => option.seconds === seconds)?.label ?? "Vypnuto";
}

export function messageRetentionShortLabel(seconds: MessageRetentionSeconds): string {
  return seconds === null ? "Vyp." : messageRetentionLabel(seconds);
}
