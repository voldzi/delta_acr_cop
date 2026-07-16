import { classifyAiResponseIntent } from "./ai-response-playbook.js";
import { inferAiQueryMeaning, normalizeAiQueryText, type AiQueryMeaning } from "./ai-query-understanding.js";

export type AiConversationFollowUpKind = "detail" | "explanation" | "location" | "map" | "time";

export interface AiConversationContinuity {
  assumptions: string[];
  contractVersion: "cop-ai-conversation-continuity-v1";
  explicitLocation?: string;
  followUp: boolean;
  followUpKind?: AiConversationFollowUpKind;
  inheritedDomain?: string;
  inheritedIntentId?: string;
  needsClarification: boolean;
  originalQuestion: string;
  previousQuestion?: string;
  resolvedQuestion: string;
  sourceMessageIds: string[];
  timeReference?: AiConversationTimeReference;
}

export interface AiConversationTimeReference {
  dayOffset?: number;
  label: string;
  offsetMinutes?: number;
  partOfDay?: "afternoon" | "evening" | "forenoon" | "morning" | "night";
}

export interface AiConversationTimeWindow {
  from: string;
  label: string;
  to: string;
  validAt: string;
}

interface VisibleChatMessage {
  ai?: Record<string, unknown>;
  body: string;
  eventId?: string;
  own: boolean;
}

interface FollowUpMatch {
  explicitLocation?: string;
  kind: AiConversationFollowUpKind;
  timeReference?: AiConversationTimeReference;
}

const timeFollowUpPattern = /^(?:a\s+)?(?:(?:co(?:\s+bude)?|jak(?:e|a|y)?(?:\s+to)?(?:\s+bude|\s+budou|\s+je|\s+jsou)?|bude|budou)\s+)?(?:(?:dnes|zitra|pozitri)(?:\s+(?:rano|dopoledne|odpoledne|vecer|v\s+noci))?|rano|dopoledne|odpoledne|vecer|v\s+noci|za\s+(?:hodinu|dve\s+hodiny|\d+\s*(?:minut|hodin|dni)))\??$/u;
const explanationFollowUpPattern = /^(?:a\s+)?(?:proc|co\s+to\s+znamena|jak\s+to|jak\s+moc|je\s+to\s+bezpecne|co\s+z\s+toho\s+plyne)\??$/u;
const mapFollowUpPattern = /^(?:a\s+)?(?:ukaz|zobraz)(?:\s+to)?\s+na\s+mape\??$/u;
const detailFollowUpPattern = /^(?:a\s+)?(?:co\s+dal|co\s+mam\s+delat|a\s+nejblizsi|nejblizsi|podrobneji|vice\s+detailu)\??$/u;
const locationFollowUpPattern = /^(?:a\s+)?(?:co\s+)?(?:v|ve|na|u)\s+(.{2,80}?)\??$/u;

export function resolveAiConversationContinuity(
  originalQuestion: string,
  chatContext: Record<string, unknown> | undefined
): AiConversationContinuity {
  const question = originalQuestion.replace(/\s+/gu, " ").trim();
  const standaloneMeaning = inferAiQueryMeaning(question);
  const match = followUpMatch(question);
  if (!match) {
    return baseContinuity(question, standaloneMeaning);
  }

  const messages = visibleMessages(chatContext);
  const anchor = previousQuestionAnchor(messages, question);
  const anchorDomain = anchor
    ? anchor.inheritedDomain ?? classifyAiResponseIntent(anchor.question)?.domain
    : undefined;
  if (standaloneMeaning && !hasContextualFollowUpCue(question) && anchorDomain !== standaloneMeaning.domain) {
    return baseContinuity(question, standaloneMeaning);
  }
  if (!anchor) {
    if (standaloneMeaning) {
      return baseContinuity(question, standaloneMeaning);
    }
    return {
      ...baseContinuity(question),
      followUp: true,
      followUpKind: match.kind,
      needsClarification: true
    };
  }

  const playbook = classifyAiResponseIntent(anchor.question);
  const timeReference = match.kind === "time"
    ? inheritTimeReference(match.timeReference, relativeTimeReference(normalize(anchor.question)))
    : undefined;
  const inheritedDomain = anchor.inheritedDomain ?? playbook?.domain;
  const inheritedIntentId = anchor.inheritedIntentId ?? playbook?.intentId;
  const resolvedQuestion = ensureInheritedTopic(resolvedFollowUpQuestion(anchor.question, question, {
    ...match,
    ...(timeReference ? { timeReference } : {})
  }), inheritedDomain);
  const assumptions = [
    `Navazující dotaz byl spojen pouze s posledním viditelným dotazem „${truncate(anchor.question, 180)}“.`
  ];
  if (match.explicitLocation) {
    assumptions.push(`Místo bylo změněno na „${match.explicitLocation}“ podle aktuálního dotazu.`);
  }
  return {
    assumptions,
    contractVersion: "cop-ai-conversation-continuity-v1",
    ...(match.explicitLocation ? { explicitLocation: match.explicitLocation } : {}),
    followUp: true,
    followUpKind: match.kind,
    ...(inheritedDomain ? { inheritedDomain } : {}),
    ...(inheritedIntentId ? { inheritedIntentId } : {}),
    needsClarification: false,
    originalQuestion: question,
    previousQuestion: anchor.question,
    resolvedQuestion,
    sourceMessageIds: anchor.eventId ? [anchor.eventId] : [],
    ...(timeReference ? { timeReference } : {})
  };
}

export function resolveAiConversationTimeWindow(
  continuity: AiConversationContinuity,
  requestNow: Date,
  timeZone = "Europe/Prague"
): AiConversationTimeWindow | undefined {
  const reference = continuity.timeReference;
  if (!reference) {
    return undefined;
  }
  if (reference.offsetMinutes !== undefined) {
    const validAt = new Date(requestNow.getTime() + reference.offsetMinutes * 60_000);
    return {
      from: new Date(validAt.getTime() - 30 * 60_000).toISOString(),
      label: reference.label,
      to: new Date(validAt.getTime() + 90 * 60_000).toISOString(),
      validAt: validAt.toISOString()
    };
  }

  const localDate = localDateParts(requestNow, timeZone);
  const dayOffset = reference.dayOffset ?? 0;
  const targetDate = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + dayOffset, 12));
  const target = {
    day: targetDate.getUTCDate(),
    month: targetDate.getUTCMonth() + 1,
    year: targetDate.getUTCFullYear()
  };
  const hours = partOfDayHours(reference.partOfDay);
  const from = zonedDateTimeToDate({ ...target, hour: hours.from }, timeZone);
  const toDate = hours.toNextDay
    ? new Date(Date.UTC(target.year, target.month - 1, target.day + 1, 12))
    : targetDate;
  const to = zonedDateTimeToDate({
    day: toDate.getUTCDate(),
    hour: hours.to,
    month: toDate.getUTCMonth() + 1,
    year: toDate.getUTCFullYear()
  }, timeZone);
  const midpoint = new Date(from.getTime() + (to.getTime() - from.getTime()) / 2);
  const validAt = reference.dayOffset === 0 && !reference.partOfDay && requestNow >= from && requestNow < to
    ? requestNow
    : midpoint;
  return {
    from: from.toISOString(),
    label: reference.label,
    to: to.toISOString(),
    validAt: validAt.toISOString()
  };
}

function baseContinuity(
  question: string,
  meaning: AiQueryMeaning | undefined = inferAiQueryMeaning(question)
): AiConversationContinuity {
  const timeReference = relativeTimeReference(normalize(question));
  return {
    assumptions: meaning ? [meaning.interpretation] : [],
    contractVersion: "cop-ai-conversation-continuity-v1",
    followUp: false,
    ...(meaning ? { inheritedDomain: meaning.domain, inheritedIntentId: meaning.intentId } : {}),
    needsClarification: false,
    originalQuestion: question,
    resolvedQuestion: meaning?.canonicalQuestion ?? question,
    sourceMessageIds: [],
    ...(timeReference ? { timeReference } : {})
  };
}

function followUpMatch(question: string): FollowUpMatch | undefined {
  const normalized = normalize(question);
  if (!normalized || normalized.length > 120) {
    return undefined;
  }
  if (timeFollowUpPattern.test(normalized)) {
    return { kind: "time", timeReference: relativeTimeReference(normalized) };
  }
  if (explanationFollowUpPattern.test(normalized)) {
    return { kind: "explanation" };
  }
  if (mapFollowUpPattern.test(normalized)) {
    return { kind: "map" };
  }
  if (detailFollowUpPattern.test(normalized)) {
    return { kind: "detail" };
  }
  const normalizedLocation = normalized.match(locationFollowUpPattern)?.[1]?.replace(/[?.!]+$/gu, "").trim();
  const explicitLocation = question
    .match(/^(?:a\s+)?(?:co\s+)?(?:v|ve|na|u)\s+(.{2,80}?)\??$/iu)?.[1]
    ?.replace(/[?.!]+$/gu, "")
    .trim();
  if (normalizedLocation && explicitLocation && !/^(?:tom|tomhle|teto|tam|tady|okoli)$/u.test(normalizedLocation)) {
    return { explicitLocation, kind: "location" };
  }
  return undefined;
}

function previousQuestionAnchor(
  messages: VisibleChatMessage[],
  currentQuestion: string
): { eventId?: string; inheritedDomain?: string; inheritedIntentId?: string; question: string } | undefined {
  const relevant = messages.slice(-10);
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const message = relevant[index]!;
    const aiQuestion = optionalText(message.ai?.question) ?? questionFromAiFallbackBody(message.body);
    if (aiQuestion && !sameQuestion(aiQuestion, currentQuestion)) {
      const responsePlaybook = isRecord(message.ai?.responsePlaybook) ? message.ai.responsePlaybook : undefined;
      return {
        ...(message.eventId ? { eventId: message.eventId } : {}),
        ...(optionalText(responsePlaybook?.domain) ? { inheritedDomain: optionalText(responsePlaybook?.domain) } : {}),
        ...(optionalText(responsePlaybook?.intentId)
          ? { inheritedIntentId: optionalText(responsePlaybook?.intentId) }
          : {}),
        question: stripAiInvocation(aiQuestion)
      };
    }
  }
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const message = relevant[index]!;
    if (!message.own || isAiMessage(message)) {
      continue;
    }
    const candidate = stripAiInvocation(message.body);
    if (candidate && !sameQuestion(candidate, currentQuestion)) {
      return {
        ...(message.eventId ? { eventId: message.eventId } : {}),
        question: candidate
      };
    }
  }
  return undefined;
}

function resolvedFollowUpQuestion(
  previousQuestion: string,
  currentQuestion: string,
  match: FollowUpMatch
): string {
  const anchor = previousQuestion.replace(/[?.!]+$/gu, "").trim();
  switch (match.kind) {
    case "time":
      return `${stripRelativeTime(anchor)}. Časové upřesnění: ${match.timeReference?.label ?? currentQuestion}.`;
    case "location":
      return `${anchor}. Použij místo ${match.explicitLocation}.`;
    case "explanation":
      return `${anchor}. Navazující žádost o vysvětlení: ${currentQuestion}`;
    case "map":
      return `${anchor}. Navazující požadavek: ukaž relevantní výsledek na mapě.`;
    case "detail":
      return `${anchor}. Navazující upřesnění: ${currentQuestion}`;
  }
}

function relativeTimeReference(normalized: string): AiConversationTimeReference | undefined {
  const dayOffset = /\bpozitri\b/u.test(normalized) ? 2 : /\bzitra\b/u.test(normalized) ? 1 : /\bdnes\b/u.test(normalized) ? 0 : undefined;
  const partOfDay = /\bv\s+noci\b/u.test(normalized)
    ? "night"
    : /\bvecer\b/u.test(normalized)
      ? "evening"
      : /\bodpoledne\b/u.test(normalized)
        ? "afternoon"
        : /\bdopoledne\b/u.test(normalized)
          ? "forenoon"
          : /\brano\b/u.test(normalized)
            ? "morning"
            : undefined;
  const duration = normalized.match(/\bza\s+(hodinu|dve\s+hodiny|(\d+)\s*(minut|hodin|dni))\b/u);
  let offsetMinutes: number | undefined;
  if (duration?.[1] === "hodinu") {
    offsetMinutes = 60;
  } else if (duration?.[1] === "dve hodiny") {
    offsetMinutes = 120;
  } else if (duration?.[2] && duration[3]) {
    const amount = Number.parseInt(duration[2], 10);
    offsetMinutes = duration[3] === "dni" ? amount * 1440 : duration[3] === "hodin" ? amount * 60 : amount;
  }
  if (dayOffset === undefined && !partOfDay && offsetMinutes === undefined) {
    return undefined;
  }
  const dayLabel = dayOffset === 0 ? "dnes" : dayOffset === 1 ? "zítra" : dayOffset === 2 ? "pozítří" : undefined;
  const partLabel = partOfDay === "morning"
    ? "ráno"
    : partOfDay === "forenoon"
      ? "dopoledne"
      : partOfDay === "afternoon"
        ? "odpoledne"
        : partOfDay === "evening"
          ? "večer"
          : partOfDay === "night"
            ? "v noci"
            : undefined;
  const durationLabel = offsetMinutes !== undefined ? normalized.match(/\bza\s+.+?(?=\?|$)/u)?.[0] : undefined;
  return {
    ...(dayOffset !== undefined ? { dayOffset } : {}),
    label: [dayLabel, partLabel].filter(Boolean).join(" ") || durationLabel || "později",
    ...(offsetMinutes !== undefined ? { offsetMinutes } : {}),
    ...(partOfDay ? { partOfDay } : {})
  };
}

function inheritTimeReference(
  current: AiConversationTimeReference | undefined,
  previous: AiConversationTimeReference | undefined
): AiConversationTimeReference | undefined {
  if (!current) {
    return undefined;
  }
  if (current.dayOffset !== undefined || current.offsetMinutes !== undefined || previous?.dayOffset === undefined) {
    return current;
  }
  const dayLabel = previous.dayOffset === 0 ? "dnes" : previous.dayOffset === 1 ? "zítra" : "pozítří";
  return {
    ...current,
    dayOffset: previous.dayOffset,
    label: `${dayLabel} ${current.label}`
  };
}

function stripRelativeTime(value: string): string {
  return value
    .replace(/\b(?:dnes|dneska|zítra|zitra|zejtra|zítřek|zitrejsek|zítřejší|zitrejsi|pozítří|pozitri|pozítřek|pozitrejsek|pozítřejší|pozitrejsi)(?:\s+(?:ráno|rano|dopoledne|odpoledne|večer|vecer|v\s+noci))?\b/giu, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s+/gu, " ")
    .replace(/[,.\s]+$/gu, "")
    .trim();
}

function ensureInheritedTopic(value: string, inheritedDomain: string | undefined): string {
  const topic = inheritedDomain ? inheritedTopic(inheritedDomain) : undefined;
  if (!topic || topic.pattern.test(normalize(value))) {
    return value;
  }
  return `${value} Téma: ${topic.label}.`;
}

function inheritedTopic(domain: string): { label: string; pattern: RegExp } | undefined {
  switch (domain) {
    case "weather":
      return { label: "počasí", pattern: /(?:^|\s)(?:pocasi|srazk|dest|bour|vitr|teplot|weather|rain|storm|wind|temperature)/u };
    case "traffic":
      return { label: "dopravní omezení a průjezdnost", pattern: /(?:doprav|uzavir|nehod|silnic|prujezd)/u };
    case "flood":
      return { label: "vodní a povodňová situace", pattern: /(?:povod|zaplav|hladin|prutok|vodomer|voda|reka)/u };
    case "fire":
      return { label: "požární situace", pattern: /(?:pozar|hori|kour|hotspot|hasic)/u };
    case "infrastructure":
      return { label: "výpadky infrastruktury", pattern: /(?:vypad|elektr|proud|plyn|vodovod|infrastruktur)/u };
    case "data":
      return { label: "dostupnost a čerstvost datových zdrojů COP/SIM", pattern: /(?:datov|zdroj|sim|cerstv|nenacita)/u };
    case "community":
      return { label: "komunitní hlášení", pattern: /(?:komunit|hlasen|nahlasil|report)/u };
    case "situation":
      return { label: "aktuální civilní situace a výstrahy", pattern: /(?:situac|vystrah|varovan|upozornen|rizik)/u };
    default:
      return undefined;
  }
}

function hasContextualFollowUpCue(question: string): boolean {
  return /^(?:a\b|jak\s+to\b|co\s+to\b)/u.test(normalize(question));
}

function localDateParts(value: Date, timeZone: string): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number.parseInt(parts.find((item) => item.type === type)?.value ?? "0", 10);
  return { day: part("day"), month: part("month"), year: part("year") };
}

function partOfDayHours(partOfDay: AiConversationTimeReference["partOfDay"]): {
  from: number;
  to: number;
  toNextDay: boolean;
} {
  switch (partOfDay) {
    case "morning":
      return { from: 5, to: 9, toNextDay: false };
    case "forenoon":
      return { from: 8, to: 12, toNextDay: false };
    case "afternoon":
      return { from: 12, to: 18, toNextDay: false };
    case "evening":
      return { from: 18, to: 23, toNextDay: false };
    case "night":
      return { from: 22, to: 6, toNextDay: true };
    default:
      return { from: 0, to: 24, toNextDay: false };
  }
}

function zonedDateTimeToDate(
  value: { day: number; hour: number; month: number; year: number },
  timeZone: string
): Date {
  const normalized = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour));
  const target = Date.UTC(
    normalized.getUTCFullYear(),
    normalized.getUTCMonth(),
    normalized.getUTCDate(),
    normalized.getUTCHours()
  );
  let candidate = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      month: "2-digit",
      timeZone,
      year: "numeric"
    }).formatToParts(new Date(candidate));
    const number = (type: Intl.DateTimeFormatPartTypes) => Number.parseInt(parts.find((item) => item.type === type)?.value ?? "0", 10);
    const represented = Date.UTC(number("year"), number("month") - 1, number("day"), number("hour"));
    candidate += target - represented;
  }
  return new Date(candidate);
}

function visibleMessages(chatContext: Record<string, unknown> | undefined): VisibleChatMessage[] {
  const raw = Array.isArray(chatContext?.messages) ? chatContext.messages : [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const body = optionalText(item.body);
    if (!body || isUnreadablePlaceholder(body)) {
      return [];
    }
    return [{
      ...(isRecord(item.ai) ? { ai: item.ai } : {}),
      body,
      ...(optionalText(item.eventId) ? { eventId: optionalText(item.eventId) } : {}),
      own: item.own === true
    }];
  });
}

function isAiMessage(message: VisibleChatMessage): boolean {
  return Boolean(message.ai) || /^COP AI agent\s*(?:\n|$)/iu.test(message.body);
}

function questionFromAiFallbackBody(body: string): string | undefined {
  return body.match(/^COP AI agent\s*\nDotaz:\s*(.+?)(?:\n|$)/iu)?.[1]?.trim();
}

function stripAiInvocation(value: string): string {
  return value
    .replace(/^\s*(?:@cop[._ -]?ai|@ai)\s*[:,]?\s*/iu, "")
    .replace(/^\s*\/(?:ai|fast|deep|local|cloud)\s+/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function sameQuestion(left: string, right: string): boolean {
  return normalize(stripAiInvocation(left)) === normalize(stripAiInvocation(right));
}

function isUnreadablePlaceholder(value: string): boolean {
  const normalized = normalize(value);
  return normalized.includes("zpravu se nepodarilo desifrovat")
    || normalized.includes("zpravu zatim nelze zobrazit")
    || normalized.includes("unable to decrypt");
}

function normalize(value: string): string {
  return normalizeAiQueryText(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
