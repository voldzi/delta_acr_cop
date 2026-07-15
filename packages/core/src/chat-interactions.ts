export type ChatAiModelPreference = "auto" | "fast" | "reasoning";

export type ChatAiCommandId =
  "ai" | "summary" | "risks" | "map" | "report" | "tasks" | "translate" | "fast" | "reasoning";

export interface ChatComposerCommand {
  aliases: readonly string[];
  description: string;
  id: ChatAiCommandId;
  label: string;
  modelPreference: ChatAiModelPreference;
  promptPrefix?: string;
  visible: boolean;
}

export interface ChatComposerSuggestion {
  description: string;
  label: string;
  value: string;
}

export interface ParsedChatAiInvocation {
  commandId?: ChatAiCommandId;
  modelPreference: ChatAiModelPreference;
  question: string;
  trigger: "direct-ai-chat" | "mention" | "slash";
}

export const chatInteractionContractVersion = "cop-chat-interactions-v1" as const;

export const chatComposerCommands: readonly ChatComposerCommand[] = [
  {
    aliases: ["ai", "cop-ai", "copai"],
    description: "Zeptat se COP AI s automatickou volbou postupu",
    id: "ai",
    label: "/ai",
    modelPreference: "auto",
    visible: true
  },
  {
    aliases: ["souhrn", "summary"],
    description: "Shrnout důležité body, rozhodnutí a nejasnosti",
    id: "summary",
    label: "/souhrn",
    modelPreference: "auto",
    promptPrefix: "Shrň relevantní konverzaci a COP kontext. Odděl fakta, rozhodnutí, nejasnosti a další kroky.",
    visible: true
  },
  {
    aliases: ["rizika", "risks"],
    description: "Vyhodnotit rizika, nejistoty a chybějící informace",
    id: "risks",
    label: "/rizika",
    modelPreference: "reasoning",
    promptPrefix: "Vyhodnoť civilní situační rizika. Odděl ověřená fakta, nejistoty a chybějící informace.",
    visible: true
  },
  {
    aliases: ["mapa", "map"],
    description: "Najít místo nebo objekt v COP mapě",
    id: "map",
    label: "/mapa",
    modelPreference: "auto",
    promptPrefix: "Najdi v COP mapě odpovídající místo nebo objekt a uveď konkrétní výsledek, vzdálenost a zdroj.",
    visible: true
  },
  {
    aliases: ["hlaseni", "hlášení", "report"],
    description: "Připravit návrh situačního hlášení k ověření",
    id: "report",
    label: "/hlášení",
    modelPreference: "reasoning",
    promptPrefix: "Připrav návrh civilního situačního hlášení k lidské kontrole. Nic automaticky neodesílej.",
    visible: true
  },
  {
    aliases: ["ukoly", "úkoly", "tasks"],
    description: "Vypsat rozhodnutí, vlastníky a otevřené kroky",
    id: "tasks",
    label: "/úkoly",
    modelPreference: "auto",
    promptPrefix: "Vypiš z konverzace rozhodnutí, otevřené kroky, případné vlastníky a termíny. Nejasné údaje označ.",
    visible: true
  },
  {
    aliases: ["prelozit", "přeložit", "translate"],
    description: "Přeložit text se zachováním významu a nejistot",
    id: "translate",
    label: "/přeložit",
    modelPreference: "auto",
    promptPrefix: "Přelož následující text. Zachovej věcný význam, názvy a výstražné formulace.",
    visible: true
  },
  {
    aliases: ["fast"],
    description: "Pokročilý kompatibilní alias pro krátkou odpověď",
    id: "fast",
    label: "/fast",
    modelPreference: "fast",
    visible: false
  },
  {
    aliases: ["reasoning", "reason"],
    description: "Pokročilý kompatibilní alias pro důkladnou analýzu",
    id: "reasoning",
    label: "/reasoning",
    modelPreference: "reasoning",
    visible: false
  }
] as const;

export function chatComposerSuggestions(
  text: string,
  options: { aiAgentAvailable: boolean } = { aiAgentAvailable: true }
): ChatComposerSuggestion[] {
  const draft = text.trimStart();
  if (!draft || draft.includes(" ")) {
    return [];
  }
  if (draft.startsWith("/")) {
    const normalized = normalizeChatToken(draft);
    return chatComposerCommands
      .filter((command) => command.visible && normalizeChatToken(command.label).startsWith(normalized))
      .map((command) => ({
        description: command.description,
        label: command.label,
        value: `${command.label} `
      }));
  }
  if (draft.startsWith("@") && options.aiAgentAvailable) {
    const normalized = normalizeChatToken(draft);
    return [
      {
        description: "Oslovit viditelného COP AI asistenta v této konverzaci",
        label: "@COP AI",
        value: "@COP AI "
      },
      {
        description: "Krátký alias pro COP AI asistenta",
        label: "@AI",
        value: "@AI "
      }
    ].filter((suggestion) => normalizeChatToken(suggestion.label).startsWith(normalized));
  }
  return [];
}

export function parseChatAiMention(text: string): string | null {
  const match = text.match(/^\s*@(?:cop[\s._-]*ai|ai)\b[\s:,-]*(?<question>[\s\S]*)$/iu);
  if (!match) {
    return null;
  }
  return (match.groups?.question ?? "").trim();
}

export function parseChatAiInvocation(
  text: string,
  options: { aiDirectChat?: boolean; groupAiAssistantEnabled?: boolean } = {}
): ParsedChatAiInvocation | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const command = parseSlashCommand(trimmed);
  if (command) {
    return command;
  }
  const mentionQuestion = options.groupAiAssistantEnabled ? parseChatAiMention(trimmed) : null;
  if (mentionQuestion !== null) {
    return {
      modelPreference: "auto",
      question: mentionQuestion,
      trigger: "mention"
    };
  }
  if (options.aiDirectChat) {
    const normalized = normalizeModelOverride(trimmed, "auto");
    return {
      modelPreference: normalized.modelPreference,
      question: normalized.question,
      trigger: "direct-ai-chat"
    };
  }
  return null;
}

function parseSlashCommand(text: string): ParsedChatAiInvocation | null {
  const match = text.match(/^\/(?<command>[^\s:,-]+)[\s:,-]*(?<question>[\s\S]*)$/iu);
  const alias = normalizeChatToken(match?.groups?.command ?? "").replace(/^\//, "");
  const command = chatComposerCommands.find((candidate) =>
    candidate.aliases.some((value) => normalizeChatToken(value) === alias)
  );
  if (!command) {
    return null;
  }
  const normalized = normalizeModelOverride(match?.groups?.question ?? "", command.modelPreference);
  const question = command.promptPrefix
    ? [command.promptPrefix, normalized.question].filter(Boolean).join(" Kontext nebo zadání: ")
    : normalized.question;
  return {
    commandId: command.id,
    modelPreference: normalized.modelPreference,
    question,
    trigger: "slash"
  };
}

function normalizeModelOverride(
  question: string,
  fallbackPreference: ChatAiModelPreference
): { modelPreference: ChatAiModelPreference; question: string } {
  const trimmed = question.trim();
  const match = trimmed.match(/^\/(?<model>reasoning|reason|fast|auto)\b[\s:,-]*(?<question>[\s\S]*)$/iu);
  if (!match?.groups) {
    return { modelPreference: fallbackPreference, question: trimmed };
  }
  const model = normalizeChatToken(match.groups.model ?? "");
  return {
    modelPreference: model === "reasoning" || model === "reason" ? "reasoning" : model === "fast" ? "fast" : "auto",
    question: (match.groups.question ?? "").trim()
  };
}

function normalizeChatToken(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("cs-CZ")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}
