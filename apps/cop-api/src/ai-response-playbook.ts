export type AiResponseIntentDomain =
  | "application"
  | "chat"
  | "fire"
  | "flood"
  | "infrastructure"
  | "map"
  | "medical"
  | "navigation"
  | "reporting"
  | "security"
  | "traffic"
  | "weather";

export type AiResponseIntentId =
  | "app.location.permission"
  | "chat.notification.status"
  | "fire.current.risk"
  | "flood.risk.summary"
  | "flood.water_level"
  | "infrastructure.outage"
  | "map.nearest.medical"
  | "map.nearest.police"
  | "map.nearest.shelter"
  | "navigation.to_target"
  | "pwa.offline.status"
  | "report.create"
  | "traffic.restrictions"
  | "weather.radar.show"
  | "weather.rain.now"
  | "weather.storm.risk"
  | "weather.temperature"
  | "weather.wind";

export type AiResponseSource =
  | "app-runtime"
  | "chat-context"
  | "indexed-context"
  | "map-search"
  | "routing"
  | "semantic-context"
  | "sim-search-data";

export type AiResponseUiAction = "focus-map" | "open-chat" | "report" | "route" | "settings" | "share-location";

export interface AiResponseAnswerContract {
  citeSources: boolean;
  includeUncertainty: boolean;
  mustMention: string[];
  mustNotInvent: string[];
  style: "brief" | "operational" | "step-by-step";
}

export interface AiResponsePlaybookRule {
  allowedActions: AiResponseUiAction[];
  answerContract: AiResponseAnswerContract;
  description: string;
  domain: AiResponseIntentDomain;
  evalTemplates: string[];
  forbiddenActions: AiResponseUiAction[];
  intentId: AiResponseIntentId;
  patterns: RegExp[];
  priority: number;
  requiredSources: AiResponseSource[];
}

export interface AiResponsePlaybookMatch {
  confidence: number;
  domain: AiResponseIntentDomain;
  intentId: AiResponseIntentId;
  matchedTerms: string[];
  rule: Omit<AiResponsePlaybookRule, "patterns" | "evalTemplates" | "priority">;
}

export interface AiResponsePlaybookEvalCase {
  allowedActions: AiResponseUiAction[];
  expectedIntentId: AiResponseIntentId;
  forbiddenActions: AiResponseUiAction[];
  id: string;
  question: string;
  requiredSources: AiResponseSource[];
}

const commonAnswerContract: AiResponseAnswerContract = {
  citeSources: true,
  includeUncertainty: true,
  mustMention: ["zdroj", "platnost dat", "nejistota"],
  mustNotInvent: ["neověřená data", "nedostupné entity", "skrytou historii chatu"],
  style: "operational"
};

export const aiResponsePlaybookRules: AiResponsePlaybookRule[] = [
  {
    allowedActions: ["focus-map"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["srážky", "časové okno", "zdroj"],
      mustNotInvent: ["celodenní předpověď bez pokrytí", "navigaci na radar"]
    },
    description: "Aktuální nebo nejbližší odpověď na déšť podle SIM meteo/radar dat.",
    domain: "weather",
    evalTemplates: [
      "Bude {time} pršet {location}?",
      "Prší {location}?",
      "Čeká mě {time} déšť {location}?",
      "Jsou {location} srážky?",
      "Mám počítat s deštěm {time} {location}?"
    ],
    forbiddenActions: ["route"],
    intentId: "weather.rain.now",
    patterns: [
      /\b(?:bude\s+)?prset\b/u,
      /\bprsi\b/u,
      /\bdest(?:e|em|i)?\b/u,
      /\bsrazk/u,
      /\brain\b/u,
      /\bprecipitation\b/u
    ],
    priority: 70,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["bouřkové riziko", "pravděpodobnost nebo chybějící metrika", "zdroj"],
      mustNotInvent: ["přesný zásah bleskem", "jistou bouřku bez dat"]
    },
    description: "Riziko bouřky a bleskové aktivity podle dostupných meteo zdrojů.",
    domain: "weather",
    evalTemplates: [
      "Blíží se {location} bouřka?",
      "Hrozí {time} bouřky {location}?",
      "Je {location} riziko blesků?",
      "Ukaž bouřkové riziko {location}.",
      "Bude {time} storm {location}?"
    ],
    forbiddenActions: ["route"],
    intentId: "weather.storm.risk",
    patterns: [/\bbourk/u, /\bblesk/u, /\bstorm\b/u, /\bthunderstorm\b/u],
    priority: 85,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["radarový produkt", "čas snímku", "zdroj"],
      mustNotInvent: ["úhrn srážek, pokud není v datech", "navigaci"]
    },
    description: "Zobrazení nebo interpretace radarové vrstvy.",
    domain: "weather",
    evalTemplates: [
      "Ukaž radar {location}.",
      "Jak vypadá srážkový radar {location}?",
      "Zobraz ČHMÚ radar {location}.",
      "Co ukazuje radar {time} {location}?",
      "Ukaž merge radar {location}."
    ],
    forbiddenActions: ["route"],
    intentId: "weather.radar.show",
    patterns: [/\bradar\b/u, /\bmax_z\b/u, /\bmerge(?:1h|_1h)?\b/u],
    priority: 95,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Teplota a teplotní kontext v okolí uživatele.",
    domain: "weather",
    evalTemplates: [
      "Jaká je teplota {location}?",
      "Kolik je stupňů {location}?",
      "Mrzne {location}?",
      "Bude {time} horko {location}?",
      "Temperature {location}?"
    ],
    forbiddenActions: ["route"],
    intentId: "weather.temperature",
    patterns: [/\bteplot/u, /\bstupn/u, /\bmrzne\b/u, /\bhorko\b/u, /\btemperature\b/u],
    priority: 60,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Vítr, nárazy větru a související meteo riziko.",
    domain: "weather",
    evalTemplates: [
      "Jak fouká {location}?",
      "Hrozí {time} silný vítr {location}?",
      "Jaké jsou nárazy větru {location}?",
      "Je {location} wind warning?",
      "Bude {time} větrno {location}?"
    ],
    forbiddenActions: ["route"],
    intentId: "weather.wind",
    patterns: [/\bvitr/u, /\bvetr/u, /\bfouka/u, /\bnaraz/u, /\bwind\b/u],
    priority: 60,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Aktuální hladina, průtok nebo vodoměrná stanice.",
    domain: "flood",
    evalTemplates: [
      "Jaká je hladina řeky {location}?",
      "Ukaž vodoměrnou stanici {location}.",
      "Jaký je průtok {location}?",
      "Je {location} SPA?",
      "Water level {location}?"
    ],
    forbiddenActions: [],
    intentId: "flood.water_level",
    patterns: [/\bhladin/u, /\bprutok/u, /\bvodomer/u, /\bspa\b/u, /\bwater\s+level\b/u],
    priority: 82,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Povodňové riziko, záplavy a souhrn vodní situace.",
    domain: "flood",
    evalTemplates: [
      "Hrozí povodeň {location}?",
      "Je {location} riziko záplavy?",
      "Shrň povodňovou situaci {location}.",
      "Flood risk {location}.",
      "Co povodeň {time} {location}?"
    ],
    forbiddenActions: [],
    intentId: "flood.risk.summary",
    patterns: [/\bpovod/u, /\bzaplav/u, /\bflood\b/u, /\briziko\s+vody\b/u],
    priority: 78,
    requiredSources: ["sim-search-data", "map-search", "semantic-context"]
  },
  {
    allowedActions: ["focus-map", "route"],
    answerContract: commonAnswerContract,
    description: "Vyhledání policie nebo bezpečnostního referenčního objektu.",
    domain: "security",
    evalTemplates: [
      "Kde je nejbližší policie {location}?",
      "Najdi policejní stanici {location}.",
      "Ukaž bezpečnostní bod {location}.",
      "Police near me {location}.",
      "Kam na policii {location}?"
    ],
    forbiddenActions: [],
    intentId: "map.nearest.police",
    patterns: [/\bpolic/u, /\bbezpecnost/u, /\bcrime\b/u, /\bsecurity\b/u],
    priority: 76,
    requiredSources: ["map-search"]
  },
  {
    allowedActions: ["focus-map", "route"],
    answerContract: commonAnswerContract,
    description: "Vyhledání nemocnice, lékaře, lékárny nebo zdravotnické pomoci.",
    domain: "medical",
    evalTemplates: [
      "Kde je nejbližší nemocnice {location}?",
      "Najdi lékárnu {location}.",
      "Ukaž zdravotnickou pomoc {location}.",
      "Doctor near me {location}.",
      "Kam pro lékaře {location}?"
    ],
    forbiddenActions: [],
    intentId: "map.nearest.medical",
    patterns: [/\bnemocnic/u, /\blekar/u, /\blekarn/u, /\bzdravot/u, /\bmedical\b/u, /\bdoctor\b/u],
    priority: 75,
    requiredSources: ["map-search"]
  },
  {
    allowedActions: ["focus-map", "route"],
    answerContract: commonAnswerContract,
    description: "Vyhledání krytu, evakuačního nebo shromažďovacího místa.",
    domain: "map",
    evalTemplates: [
      "Kde je nejbližší kryt {location}?",
      "Najdi evakuační místo {location}.",
      "Ukaž shelter {location}.",
      "Kam se ukrýt {location}?",
      "Kde je assembly point {location}?"
    ],
    forbiddenActions: [],
    intentId: "map.nearest.shelter",
    patterns: [/\bkryt/u, /\bukryt/u, /\bshelter\b/u, /\bevakuac/u, /\bassembly\s+point\b/u],
    priority: 74,
    requiredSources: ["map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Dopravní omezení, nehody a průjezdnost.",
    domain: "traffic",
    evalTemplates: [
      "Jsou {location} dopravní omezení?",
      "Je někde uzavírka {location}?",
      "Ukaž nehody {location}.",
      "Je průjezdná silnice {location}?",
      "Traffic restrictions {location}."
    ],
    forbiddenActions: [],
    intentId: "traffic.restrictions",
    patterns: [/\bdoprav/u, /\buzavir/u, /\bnehod/u, /\bsilnic/u, /\btraffic\b/u, /\broad\b/u],
    priority: 64,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Požár, kouř, hotspot nebo dostupnost hasičů.",
    domain: "fire",
    evalTemplates: [
      "Hoří {location}?",
      "Je vidět kouř {location}?",
      "Ukaž požáry {location}.",
      "Kde jsou hasiči {location}?",
      "Fire risk {location}."
    ],
    forbiddenActions: [],
    intentId: "fire.current.risk",
    patterns: [/\bpozar/u, /\bhori\b/u, /\bkour/u, /\bhasic/u, /\bhotspot\b/u, /\bfire\b/u],
    priority: 68,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Výpadky nebo problémy infrastruktury.",
    domain: "infrastructure",
    evalTemplates: [
      "Je {location} výpadek elektřiny?",
      "Nefunguje vodovod {location}?",
      "Je problém s plynem {location}?",
      "Ukaž infrastrukturu {location}.",
      "Utility outage {location}."
    ],
    forbiddenActions: [],
    intentId: "infrastructure.outage",
    patterns: [/\bvypad/u, /\belektr/u, /\bplyn/u, /\bvodovod/u, /\binfrastruktur/u, /\butility\b/u, /\boutage\b/u],
    priority: 63,
    requiredSources: ["sim-search-data", "semantic-context"]
  },
  {
    allowedActions: ["focus-map", "route"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["cílový bod", "profil trasy", "offline omezení"],
      mustNotInvent: ["trasu bez routing výsledku"]
    },
    description: "Spuštění nebo příprava navigace k bodu, objektu nebo sdílené poloze.",
    domain: "navigation",
    evalTemplates: [
      "Naviguj mě {location}.",
      "Spusť trasu {location}.",
      "Jak se dostanu {location}?",
      "Chci jet autem {location}.",
      "Route me {location}."
    ],
    forbiddenActions: [],
    intentId: "navigation.to_target",
    patterns: [
      /\bnaviguj/u,
      /\bnavigac/u,
      /\btrasa\b/u,
      /\btrasu\b/u,
      /\bjak\s+se\s+dostanu\b/u,
      /\bjet\b/u,
      /\bautem\b/u,
      /\bpesky\b/u,
      /\broute\b/u
    ],
    priority: 72,
    requiredSources: ["routing", "map-search"]
  },
  {
    allowedActions: ["open-chat", "settings"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["stav notifikací", "nepřečtené zprávy", "synchronizace"],
      mustNotInvent: ["neviděnou historii místnosti"]
    },
    description: "Stav chatových zpráv, notifikací a nepřečtených počtů.",
    domain: "chat",
    evalTemplates: [
      "Proč mám nepřečtené zprávy?",
      "Nesedí mi badge v chatu.",
      "Nepřišla mi notifikace.",
      "Chat ukazuje špatný počet.",
      "Unread messages status?"
    ],
    forbiddenActions: ["route"],
    intentId: "chat.notification.status",
    patterns: [/\bchat\b/u, /\bzprav/u, /\bnotifik/u, /\bbadge\b/u, /\bneprecten/u, /\bunread\b/u],
    priority: 66,
    requiredSources: ["app-runtime", "chat-context"]
  },
  {
    allowedActions: ["settings"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["cache", "offline režim", "přihlášení"],
      mustNotInvent: ["stav zařízení bez diagnostiky"]
    },
    description: "PWA, offline cache, udržení přihlášení a lokální úložiště.",
    domain: "application",
    evalTemplates: [
      "Funguje PWA offline?",
      "Drží aplikace přihlášení?",
      "Proč se appka dlouho spouští?",
      "Jak je na tom cache?",
      "Offline status aplikace."
    ],
    forbiddenActions: ["route"],
    intentId: "pwa.offline.status",
    patterns: [/\bpwa\b/u, /\boffline\b/u, /\bcache\b/u, /\bprihlasen/u, /\bulozist/u, /\bappk/u, /\bspoust/u],
    priority: 67,
    requiredSources: ["app-runtime", "indexed-context"]
  },
  {
    allowedActions: ["settings", "share-location"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["oprávnění polohy", "fallback středu ČR", "přesnost"],
      mustNotInvent: ["aktuální GPS bez souhlasu prohlížeče"]
    },
    description: "Poloha zařízení, oprávnění GPS a centrování mapy.",
    domain: "application",
    evalTemplates: [
      "Proč nefunguje moje poloha?",
      "Mapa mě necentruje.",
      "GPS ukazuje špatně.",
      "Aplikace nevidí lokaci.",
      "Location permission status?"
    ],
    forbiddenActions: ["route"],
    intentId: "app.location.permission",
    patterns: [/\bpoloha\b/u, /\bgps\b/u, /\blokac/u, /\bcentruj/u, /\bnecentruj/u, /\blocation\b/u],
    priority: 62,
    requiredSources: ["app-runtime"]
  },
  {
    allowedActions: ["report", "focus-map"],
    answerContract: commonAnswerContract,
    description: "Založení hlášení, sdílení fotky nebo popis incidentu od uživatele.",
    domain: "reporting",
    evalTemplates: [
      "Chci nahlásit problém.",
      "Nahlásit poškozený most {location}.",
      "Pošlu fotku incidentu.",
      "Vytvoř hlášení {location}.",
      "Create report {location}."
    ],
    forbiddenActions: [],
    intentId: "report.create",
    patterns: [/\bnahlas/u, /\bhlaseni\b/u, /\breport\b/u, /\bincident\b/u, /\bfotk/u],
    priority: 65,
    requiredSources: ["app-runtime", "map-search"]
  }
];

const evalLocations = [
  "u mě",
  "v okolí",
  "v Praze",
  "v Brně",
  "v Ostravě",
  "ve Vrbně",
  "u sdílené polohy",
  "na mapě",
  "kolem aktuální polohy",
  "v centru ČR",
  "v obci",
  "u řeky",
  "u stanoviště",
  "u operátora",
  "v zadané oblasti"
];

const evalTimes = ["teď", "dnes", "za hodinu", "večer", "ráno", "během dne", "v nejbližší době", "aktuálně"];

const evalLeadIns = [
  "",
  "Prosím ",
  "Rychle ",
  "COP AI, ",
  "Můžeš ověřit, ",
  "Potřebuju vědět, ",
  "Operátorsky: ",
  "Pro zásah: "
];

const evalSuffixes = [
  "",
  " díky",
  " a ukaž jistotu",
  " podle SIM",
  " pro občana",
  " stručně",
  " s časem dat",
  " bez zbytečností"
];

const evalContextPhrases = [
  "",
  " pro mobil",
  " v aplikaci",
  " pro operátora",
  " pro občana",
  " v krizovém režimu",
  " pro skupinu",
  " s mapovým kontextem",
  " se zdroji",
  " s posledními daty",
  " pro aktuální zásah",
  " v terénu",
  " pro velitele",
  " s omezeným připojením",
  " s ohledem na polohu",
  " jako stručnou odpověď"
];

export function classifyAiResponseIntent(question: string): AiResponsePlaybookMatch | undefined {
  const normalized = normalizeAiResponseQuestion(question);
  if (!normalized) {
    return undefined;
  }

  let best: { matchedTerms: string[]; rule: AiResponsePlaybookRule; score: number } | undefined;
  for (const rule of aiResponsePlaybookRules) {
    const matchedTerms = rule.patterns
      .filter((pattern) => pattern.test(normalized))
      .map((pattern) => pattern.source);
    if (matchedTerms.length === 0) {
      continue;
    }
    const score = rule.priority + matchedTerms.length * 20;
    if (!best || score > best.score) {
      best = { matchedTerms, rule, score };
    }
  }

  if (!best) {
    return undefined;
  }
  return toPlaybookMatch(best.rule, best.matchedTerms, Math.min(0.99, best.score / 140));
}

export function aiResponsePlaybookGuidanceForQuestion(question: string): Record<string, unknown> | undefined {
  const match = classifyAiResponseIntent(question);
  if (!match) {
    return undefined;
  }
  return {
    allowedActions: match.rule.allowedActions,
    answerContract: match.rule.answerContract,
    confidence: match.confidence,
    domain: match.domain,
    forbiddenActions: match.rule.forbiddenActions,
    intentId: match.intentId,
    requiredSources: match.rule.requiredSources
  };
}

export function aiResponsePlaybookPromptGuidance(question: string): string | undefined {
  const match = classifyAiResponseIntent(question);
  if (!match) {
    return undefined;
  }
  return [
    `ResponsePlaybook intent=${match.intentId}, domain=${match.domain}, confidence=${match.confidence.toFixed(2)}.`,
    `Required sources: ${match.rule.requiredSources.join(", ") || "none"}.`,
    `Allowed UI actions: ${match.rule.allowedActions.join(", ") || "none"}.`,
    `Forbidden UI actions: ${match.rule.forbiddenActions.join(", ") || "none"}.`,
    `Answer must mention: ${match.rule.answerContract.mustMention.join(", ")}.`,
    `Do not invent: ${match.rule.answerContract.mustNotInvent.join(", ")}.`
  ].join(" ");
}

export function buildAiResponsePlaybookEvalCases(targetCount = 10_000): AiResponsePlaybookEvalCase[] {
  const cases: AiResponsePlaybookEvalCase[] = [];
  let cursor = 0;
  while (cases.length < targetCount) {
    const rule = aiResponsePlaybookRules[cursor % aiResponsePlaybookRules.length]!;
    const template = rule.evalTemplates[Math.floor(cursor / aiResponsePlaybookRules.length) % rule.evalTemplates.length]!;
    const leadIn = evalLeadIns[Math.floor(cursor / (aiResponsePlaybookRules.length * rule.evalTemplates.length)) % evalLeadIns.length]!;
    const suffix = evalSuffixes[Math.floor(cursor / 3) % evalSuffixes.length]!;
    const contextPhrase = evalContextPhrases[Math.floor(cursor / 720) % evalContextPhrases.length]!;
    const location = evalLocations[(cursor + rule.priority) % evalLocations.length]!;
    const time = evalTimes[(cursor + rule.priority) % evalTimes.length]!;
    const question = `${leadIn}${template.replace("{location}", location).replace("{time}", time)}${suffix}${contextPhrase}`
      .replace(/\s+/gu, " ")
      .trim();
    cases.push({
      allowedActions: rule.allowedActions,
      expectedIntentId: rule.intentId,
      forbiddenActions: rule.forbiddenActions,
      id: `${rule.intentId}:${String(cases.length + 1).padStart(5, "0")}`,
      question,
      requiredSources: rule.requiredSources
    });
    cursor += 1;
  }
  return cases;
}

function toPlaybookMatch(
  rule: AiResponsePlaybookRule,
  matchedTerms: string[],
  confidence: number
): AiResponsePlaybookMatch {
  return {
    confidence,
    domain: rule.domain,
    intentId: rule.intentId,
    matchedTerms,
    rule: {
      allowedActions: rule.allowedActions,
      answerContract: rule.answerContract,
      description: rule.description,
      domain: rule.domain,
      forbiddenActions: rule.forbiddenActions,
      intentId: rule.intentId,
      requiredSources: rule.requiredSources
    }
  };
}

function normalizeAiResponseQuestion(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
}
