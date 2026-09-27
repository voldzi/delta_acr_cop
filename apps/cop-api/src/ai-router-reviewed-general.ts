/** Server-owned questions contain no user text or COP situation context. */
const QUESTIONS = {
  flood_preparedness: "Vysvětli obecné zásady přípravy domácnosti na povodeň. Nepředpokládej konkrétní místo ani aktuální událost.",
  warning_levels: "Vysvětli obecně, co znamenají stupně povodňové aktivity v České republice. Nehodnoť aktuální situaci.",
  information_sources: "Vysvětli obecně, jak ověřovat veřejné informace o mimořádné události. Neuváděj konkrétní incident."
} as const;

export type ReviewedGeneralTopic = keyof typeof QUESTIONS;

export function reviewedGeneralQuestion(value: unknown): string | undefined {
  if (typeof value !== "string" || !Object.hasOwn(QUESTIONS, value)) return undefined;
  return QUESTIONS[value as ReviewedGeneralTopic];
}
