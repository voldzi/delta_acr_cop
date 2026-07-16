export interface AiQueryMeaning {
  canonicalQuestion: string;
  confidence: number;
  domain: string;
  intentId: string;
  interpretation: string;
}

interface AiQueryMeaningRule {
  canonicalQuestion: (question: string, normalized: string, match: RegExpMatchArray) => string;
  confidence: number;
  domain: string;
  intentId: string;
  interpretation: string;
  pattern: RegExp;
}

const meaningRules: AiQueryMeaningRule[] = [
  {
    canonicalQuestion: (_question, _normalized, match) => `Jaké bude počasí${match.groups?.detail ? ` ${match.groups.detail}` : ""}?`,
    confidence: 0.97,
    domain: "weather",
    intentId: "weather.summary.forecast",
    interpretation: "Obecná česká formulace „Jak bude…“ byla vyhodnocena jako dotaz na počasí.",
    pattern: /^(?:a\s+)?jak\s+bude(?:\s+(?<detail>(?:(?:dnes|zitra|pozitri)(?:\s+(?:rano|dopoledne|odpoledne|vecer|v\s+noci))?|rano|dopoledne|odpoledne|vecer|v\s+noci)(?:\s+.*)?|(?:v|ve|u|na)\s+.+))?\??$/u
  },
  {
    canonicalQuestion: (question) => `Jaká je aktuální civilní situace? Kontext dotazu: ${question}`,
    confidence: 0.9,
    domain: "situation",
    intentId: "situation.summary",
    interpretation: "Obecný dotaz na aktuální stav byl vyhodnocen jako situační přehled COP.",
    pattern: /^(?:a\s+)?(?:jak\s+to\s+vypada|co\s+je\s+nove|co\s+se\s+deje)(?:\s+(?:tady|zde|kolem\s+me|v\s+okoli|u\s+me|v\s+.+))?\??$/u
  },
  {
    canonicalQuestion: (question) => `Jaké jsou aktivní výstrahy a aktuální nebezpečí? Kontext dotazu: ${question}`,
    confidence: 0.94,
    domain: "situation",
    intentId: "alerts.active",
    interpretation: "Obecná otázka na hrozby byla vyhodnocena jako dotaz na aktivní výstrahy.",
    pattern: /^(?:a\s+)?(?:hrozi\s+neco|je\s+(?:tu|tady|zde|v\s+okoli\s+)?neco\s+nebezpecne|na\s+co\s+si\s+dat\s+pozor)(?:\s+.*)?\??$/u
  },
  {
    canonicalQuestion: (question) => `Jsou datové zdroje COP/SIM dostupné, aktuální a v pořádku? Kontext dotazu: ${question}`,
    confidence: 0.96,
    domain: "data",
    intentId: "source.health",
    interpretation: "Hovorový dotaz na data byl vyhodnocen jako kontrola dostupnosti a čerstvosti zdrojů COP/SIM.",
    pattern: /^(?:a\s+)?(?:funguji|fungujou|jedou)\s+(?:nam\s+)?data\??$|^(?:a\s+)?(?:jsou\s+data\s+(?:ok|aktualni|cerstva)|co\s+se\s+nenacita|odkud\s+jsou\s+data)\??$/u
  },
  {
    canonicalQuestion: (question) => `Jaká je aktuální vodní a povodňová situace? Kontext dotazu: ${question}`,
    confidence: 0.92,
    domain: "flood",
    intentId: "flood.risk.summary",
    interpretation: "Obecný dotaz na vodu nebo řeku byl vyhodnocen jako vodní a povodňová situace.",
    pattern: /^(?:a\s+)?(?:jak\s+je\s+na\s+tom\s+(?:voda|reka)|co\s+dela\s+(?:voda|reka)|je\s+(?:te|tam|tady|zde)\s+vody\s+moc)(?:\s+.*)?\??$/u
  },
  {
    canonicalQuestion: (question) => `Jaká jsou aktuální dopravní omezení a průjezdnost? Kontext dotazu: ${question}`,
    confidence: 0.93,
    domain: "traffic",
    intentId: "traffic.restrictions",
    interpretation: "Obecný dotaz na průjezdnost byl vyhodnocen jako dopravní situace.",
    pattern: /^(?:a\s+)?(?:da\s+se\s+(?:tam|tudy|to|pres\s+.+)?\s*projet|jak\s+to\s+vypada\s+na\s+silnicich|kudy\s+nejezdit|jsou\s+silnice\s+(?:ok|prujezdne))(?:\s+.*)?\??$/u
  },
  {
    canonicalQuestion: (question) => `Kde jsou aktuálně hlášené požáry nebo kouř? Kontext dotazu: ${question}`,
    confidence: 0.95,
    domain: "fire",
    intentId: "fire.current.risk",
    interpretation: "Obecný dotaz na hoření nebo kouř byl vyhodnocen jako požární situace.",
    pattern: /^(?:a\s+)?(?:kde\s+hori|je\s+nekde\s+(?:pozar|kour)|hori\s+nekde)(?:\s+.*)?\??$/u
  },
  {
    canonicalQuestion: (question) => `Jsou hlášené výpadky elektřiny, vody nebo plynu? Kontext dotazu: ${question}`,
    confidence: 0.93,
    domain: "infrastructure",
    intentId: "infrastructure.outage",
    interpretation: "Hovorový dotaz na dodávky byl vyhodnocen jako stav kritické infrastruktury.",
    pattern: /^(?:a\s+)?(?:(?:jde|funguje)\s+(?:(?:tu|tady|zde|u\s+nas)\s+)?(?:proud|elektrina|plyn)|tece\s+(?:(?:tu|tady|zde|u\s+nas)\s+)?voda)(?:\s+.*)?\??$/u
  },
  {
    canonicalQuestion: (question) => `Jaká jsou aktuální komunitní hlášení? Kontext dotazu: ${question}`,
    confidence: 0.91,
    domain: "community",
    intentId: "community.reports.summary",
    interpretation: "Hovorový dotaz na hlášení lidí byl vyhodnocen jako souhrn komunitních hlášení.",
    pattern: /^(?:a\s+)?(?:co\s+hlasi\s+lidi|co\s+nahlasili\s+lidi|co\s+pisou\s+lidi)(?:\s+.*)?\??$/u
  }
];

export function inferAiQueryMeaning(question: string): AiQueryMeaning | undefined {
  const normalized = normalizeAiQueryText(question);
  if (!normalized || normalized.length > 500) {
    return undefined;
  }
  for (const rule of meaningRules) {
    const match = normalized.match(rule.pattern);
    if (!match) {
      continue;
    }
    return {
      canonicalQuestion: rule.canonicalQuestion(question, normalized, match).replace(/\s+/gu, " ").trim(),
      confidence: rule.confidence,
      domain: rule.domain,
      intentId: rule.intentId,
      interpretation: rule.interpretation
    };
  }
  return undefined;
}

export function normalizeAiQueryText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\bdneska\b/gu, "dnes")
    .replace(/\b(?:zejtra|zitrejsek|zitrejsi(?:ho|mu|m)?)\b/gu, "zitra")
    .replace(/\b(?:pozitrejsek|pozitrejsi(?:ho|mu|m)?)\b/gu, "pozitri")
    .replace(/\btedka\b/gu, "ted")
    .replace(/\s+/gu, " ")
    .trim();
}
