import { classifyAiResponseIntent } from "./ai-response-playbook.js";

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
}

const timeFollowUpPattern = /^(?:a\s+)?(?:co\s+)?(?:dnes|zitra|pozitri|rano|dopoledne|odpoledne|vecer|v\s+noci|za\s+(?:hodinu|dve\s+hodiny|\d+\s*(?:minut|hodin|dni)))\??$/u;
const explanationFollowUpPattern = /^(?:a\s+)?(?:proc|co\s+to\s+znamena|jak\s+to|jak\s+moc|je\s+to\s+bezpecne|co\s+z\s+toho\s+plyne)\??$/u;
const mapFollowUpPattern = /^(?:a\s+)?(?:ukaz|zobraz)(?:\s+to)?\s+na\s+mape\??$/u;
const detailFollowUpPattern = /^(?:a\s+)?(?:co\s+dal|co\s+mam\s+delat|a\s+nejblizsi|nejblizsi|podrobneji|vice\s+detailu)\??$/u;
const locationFollowUpPattern = /^(?:a\s+)?(?:co\s+)?(?:v|ve|na|u)\s+(.{2,80}?)\??$/u;

export function resolveAiConversationContinuity(
  originalQuestion: string,
  chatContext: Record<string, unknown> | undefined
): AiConversationContinuity {
  const question = originalQuestion.replace(/\s+/gu, " ").trim();
  const match = followUpMatch(question);
  if (!match) {
    return baseContinuity(question);
  }

  const messages = visibleMessages(chatContext);
  const anchor = previousQuestionAnchor(messages, question);
  if (!anchor) {
    return {
      ...baseContinuity(question),
      followUp: true,
      followUpKind: match.kind,
      needsClarification: true
    };
  }

  const playbook = classifyAiResponseIntent(anchor.question);
  const resolvedQuestion = resolvedFollowUpQuestion(anchor.question, question, match);
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
    ...(playbook?.domain ? { inheritedDomain: playbook.domain } : {}),
    ...(playbook?.intentId ? { inheritedIntentId: playbook.intentId } : {}),
    needsClarification: false,
    originalQuestion: question,
    previousQuestion: anchor.question,
    resolvedQuestion,
    sourceMessageIds: anchor.eventId ? [anchor.eventId] : []
  };
}

function baseContinuity(question: string): AiConversationContinuity {
  return {
    assumptions: [],
    contractVersion: "cop-ai-conversation-continuity-v1",
    followUp: false,
    needsClarification: false,
    originalQuestion: question,
    resolvedQuestion: question,
    sourceMessageIds: []
  };
}

function followUpMatch(question: string): FollowUpMatch | undefined {
  const normalized = normalize(question);
  if (!normalized || normalized.length > 120) {
    return undefined;
  }
  if (timeFollowUpPattern.test(normalized)) {
    return { kind: "time" };
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
): { eventId?: string; question: string } | undefined {
  const relevant = messages.slice(-10);
  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const message = relevant[index]!;
    const aiQuestion = optionalText(message.ai?.question) ?? questionFromAiFallbackBody(message.body);
    if (aiQuestion && !sameQuestion(aiQuestion, currentQuestion)) {
      return {
        ...(message.eventId ? { eventId: message.eventId } : {}),
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
      return `${anchor}. Časové upřesnění: ${currentQuestion}`;
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
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
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
