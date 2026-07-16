import { normalizeAiQueryText } from "./ai-query-understanding.js";

export type AiResponseIntentDomain =
  | "application"
  | "chat"
  | "community"
  | "data"
  | "emergency"
  | "fire"
  | "flood"
  | "infrastructure"
  | "map"
  | "medical"
  | "navigation"
  | "reporting"
  | "security"
  | "situation"
  | "traffic"
  | "weather";

export type AiResponseIntentId =
  | "app.location.permission"
  | "alerts.active"
  | "chat.notification.status"
  | "chat.delivery.status"
  | "chat.encryption.recovery"
  | "chat.conversation.summary"
  | "community.reports.summary"
  | "cop.capabilities.help"
  | "emergency.immediate.help"
  | "fire.current.risk"
  | "flood.risk.summary"
  | "flood.water_level"
  | "infrastructure.outage"
  | "map.nearest.medical"
  | "map.nearest.police"
  | "map.nearest.fire_station"
  | "map.nearest.aed"
  | "map.nearest.shelter"
  | "navigation.to_target"
  | "pwa.offline.status"
  | "report.create"
  | "situation.summary"
  | "source.health"
  | "traffic.restrictions"
  | "weather.radar.show"
  | "weather.rain.now"
  | "weather.summary.forecast"
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
    allowedActions: ["share-location"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["tísňovou linku", "bezpečí volajícího", "pokyny dispečera"],
      mustNotInvent: ["diagnózu", "taktický zásah", "potvrzení, že pomoc už byla vyslána"],
      style: "step-by-step"
    },
    description: "Bezprostřední ohrožení života, zdraví nebo bezpečnosti, které vyžaduje tísňovou linku.",
    domain: "emergency",
    evalTemplates: [
      "Člověk {location} nedýchá, co mám dělat?",
      "Je tu silné krvácení {location}.",
      "Jsem v bezprostředním nebezpečí {location}.",
      "Hoří dům {location}, potřebuji okamžitou pomoc.",
      "Emergency help {location}."
    ],
    forbiddenActions: ["route"],
    intentId: "emergency.immediate.help",
    patterns: [
      /\bnedycha\b/u,
      /\bbezvedom/u,
      /\bsiln(?:e|y)\s+krvac/u,
      /\bbezprostredn(?:i|im)\s+nebezpec/u,
      /\bohrozeni\s+zivota\b/u,
      /\bokamzit(?:a|ou)\s+pomoc\b/u,
      /\bhori\s+(?:dum|byt|budova)\b/u,
      /\bemergency\s+help\b/u
    ],
    priority: 140,
    requiredSources: []
  },
  {
    allowedActions: ["focus-map", "open-chat", "report", "settings", "share-location"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      includeUncertainty: false,
      mustMention: ["dostupné schopnosti", "omezení", "příklad dotazu"],
      mustNotInvent: ["schopnost provést akci bez potvrzení", "přístup k neviditelným datům"],
      style: "brief"
    },
    description: "Nápověda k tomu, s čím COP AI umí bezpečně pomoci.",
    domain: "application",
    evalTemplates: [
      "Co umíš?",
      "S čím mi COP AI pomůže?",
      "Ukaž nápovědu.",
      "Jaké dotazy ti mohu položit?",
      "What can you do?"
    ],
    forbiddenActions: ["route"],
    intentId: "cop.capabilities.help",
    patterns: [/\bco\s+umis\b/u, /\bs\s+cim\s+(?:mi\s+)?(?:cop\s+ai\s+)?(?:pomuze|pomuzes|pomoci)\b/u, /\bnapoved/u, /\bjake\s+dotazy\b/u, /\bwhat\s+can\s+you\s+do\b/u],
    priority: 100,
    requiredSources: []
  },
  {
    allowedActions: ["focus-map"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["nejdůležitější události", "čas dat", "chybějící pokrytí"],
      mustNotInvent: ["události mimo dostupný COP kontext", "jistotu bez zdroje"],
      style: "operational"
    },
    description: "Souhrn aktuální civilní situace z výstrah, incidentů, hlášení a mapových dat.",
    domain: "situation",
    evalTemplates: [
      "Jaká je situace {location}?",
      "Co se děje {location}?",
      "Dej mi situační přehled {location}.",
      "Shrň aktuální rizika {location}.",
      "Situation summary {location}."
    ],
    forbiddenActions: ["route"],
    intentId: "situation.summary",
    patterns: [/\bjaka\s+je\s+situace\b/u, /\bco\s+se\s+deje\b/u, /\bjak\s+to\s+vypada\b/u, /\bco\s+je\s+nove\b/u, /\bsituacni\s+prehled\b/u, /\bshrn\w*\s+(?:aktualni\s+)?rizik/u, /\bsituation\s+summary\b/u],
    priority: 58,
    requiredSources: ["semantic-context", "indexed-context", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Aktivní výstrahy a varování v dostupném COP kontextu.",
    domain: "situation",
    evalTemplates: [
      "Jaké jsou aktivní výstrahy {location}?",
      "Je vydané nějaké varování {location}?",
      "Ukaž aktuální upozornění {location}.",
      "Hrozí něco nebezpečného {location}?",
      "Active alerts {location}."
    ],
    forbiddenActions: ["route"],
    intentId: "alerts.active",
    patterns: [/\baktivni\s+vystrah/u, /\bvarovan/u, /\baktualni\s+upozornen/u, /\bhrozi\s+neco(?:\s+nebezpec)?\b/u, /\bna\s+co\s+si\s+dat\s+pozor\b/u, /\bactive\s+alerts?\b/u],
    priority: 79,
    requiredSources: ["semantic-context", "indexed-context", "map-search"]
  },
  {
    allowedActions: ["focus-map", "report"],
    answerContract: commonAnswerContract,
    description: "Souhrn publikovaných komunitních hlášení dostupných uživateli.",
    domain: "community",
    evalTemplates: [
      "Jaká jsou hlášení od lidí {location}?",
      "Shrň komunitní hlášení {location}.",
      "Co nahlásili občané {location}?",
      "Ukaž poslední reporty komunity {location}.",
      "Community reports {location}."
    ],
    forbiddenActions: ["route"],
    intentId: "community.reports.summary",
    patterns: [/\bhlaseni\s+od\s+lidi\b/u, /\bkomunitni\s+hlasen/u, /\bco\s+nahlasili\s+obcan/u, /\breporty\s+komunit/u, /\bcommunity\s+reports?\b/u],
    priority: 80,
    requiredSources: ["semantic-context", "indexed-context"]
  },
  {
    allowedActions: ["settings"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["stav zdrojů", "stáří dat", "omezení pokrytí"],
      mustNotInvent: ["online stav bez diagnostiky", "příčinu výpadku bez evidence"]
    },
    description: "Zdraví, čerstvost a dostupnost datových zdrojů COP/SIM.",
    domain: "data",
    evalTemplates: [
      "Jsou datové zdroje v pořádku?",
      "Jak čerstvá jsou data?",
      "Které zdroje mají problém?",
      "Funguje SIM napojení?",
      "Data source health."
    ],
    forbiddenActions: ["route"],
    intentId: "source.health",
    patterns: [/\bdatove\s+zdroje\b/u, /\bcerstv\w*\s+jsou\s+data\b/u, /\b(?:funguji|fungujou|jedou)\s+(?:nam\s+)?data\b/u, /\bjsou\s+data\s+(?:ok|aktualni|cerstva)\b/u, /\bco\s+se\s+nenacita\b/u, /\bodkud\s+jsou\s+data\b/u, /\bktere\s+zdroje\s+maji\s+problem\b/u, /\bsim\s+napojen/u, /\bdata\s+source\s+health\b/u],
    priority: 84,
    requiredSources: ["app-runtime", "indexed-context"]
  },
  {
    allowedActions: ["open-chat"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["viditelný výňatek chatu", "hlavní témata", "nevyřešené body"],
      mustNotInvent: ["neviděnou historii", "obsah nečitelných zpráv"]
    },
    description: "Shrnutí viditelné dešifrované části aktuální konverzace.",
    domain: "chat",
    evalTemplates: [
      "Shrň tento chat.",
      "Co jsme v konverzaci řešili?",
      "Jaké jsou nevyřešené body diskuze?",
      "Udělej souhrn posledních zpráv.",
      "Summarize this conversation."
    ],
    forbiddenActions: ["route"],
    intentId: "chat.conversation.summary",
    patterns: [/\bshrn\w*\s+(?:tento\s+)?chat\b/u, /\bco\s+jsme\s+v\s+konverzaci\s+resili\b/u, /\bnevyresene\s+body\s+diskuze\b/u, /\bsouhrn\s+poslednich\s+zprav\b/u, /\bsummarize\s+this\s+conversation\b/u],
    priority: 92,
    requiredSources: ["chat-context"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: {
      ...commonAnswerContract,
      mustMention: ["místo", "časové okno", "stručnou předpověď", "výstrahy", "zdroj"],
      mustNotInvent: [
        "předpověď bez určeného místa",
        "hodnoty chybějící ve zdroji",
        "interní názvy vrstev nebo zdrojů",
        "souřadnice, pokud si je uživatel nevyžádal"
      ],
      style: "brief"
    },
    description: "Souhrnná předpověď počasí pro určené místo a nejbližší relevantní časové okno.",
    domain: "weather",
    evalTemplates: [
      "Jaké bude počasí {location} {time}?",
      "Jaká je předpověď {location} {time}?",
      "Co čekat od počasí {location} {time}?",
      "Shrň počasí {location} {time}.",
      "Weather forecast {location} {time}?"
    ],
    forbiddenActions: ["route"],
    intentId: "weather.summary.forecast",
    patterns: [/\bpocasi\b/u, /\bpredpoved/u, /\bforecast\b/u, /\bmeteogram\b/u, /^(?:a\s+)?jak\s+bude(?:\s+(?:(?:dnes|zitra|pozitri|rano|dopoledne|odpoledne|vecer|v\s+noci)(?:\s+.*)?|(?:v|ve|u|na)\s+.+))?\??$/u],
    priority: 50,
    requiredSources: ["sim-search-data", "map-search"]
  },
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
    patterns: [/\bpovod/u, /\bzaplav/u, /\bflood\b/u, /\briziko\s+vody\b/u, /\bjak\s+je\s+na\s+tom\s+(?:voda|reka)\b/u, /\bco\s+dela\s+(?:voda|reka)\b/u],
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
    description: "Vyhledání nejbližší hasičské stanice; nejde o potvrzení probíhajícího zásahu.",
    domain: "fire",
    evalTemplates: [
      "Kde je nejbližší hasičská stanice {location}?",
      "Najdi hasiče {location}.",
      "Ukaž požární stanici {location}.",
      "Fire station near me {location}.",
      "Kam k hasičům {location}?"
    ],
    forbiddenActions: [],
    intentId: "map.nearest.fire_station",
    patterns: [/\bhasicsk\w*\s+stanic/u, /\bpozarni\s+stanic/u, /\bnejbliz\w*\s+hasic/u, /\b(?:kde\s+jsou|najdi)\s+hasic/u, /\bkam\s+k\s+hasic/u, /\bfire\s+station\b/u],
    priority: 88,
    requiredSources: ["map-search"]
  },
  {
    allowedActions: ["focus-map", "route"],
    answerContract: commonAnswerContract,
    description: "Vyhledání veřejně dostupného AED nebo defibrilátoru.",
    domain: "medical",
    evalTemplates: [
      "Kde je nejbližší AED {location}?",
      "Najdi defibrilátor {location}.",
      "Ukaž veřejný defibrilátor {location}.",
      "AED near me {location}.",
      "Kam pro defibrilátor {location}?"
    ],
    forbiddenActions: [],
    intentId: "map.nearest.aed",
    patterns: [/\baed\b/u, /\bdefibril/u],
    priority: 87,
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
    patterns: [/\bdoprav/u, /\buzavir/u, /\bnehod/u, /\bsilnic/u, /\bda\s+se\s+(?:tam|tudy|to|pres\s+\w+)?\s*projet\b/u, /\bkudy\s+nejezdit\b/u, /\btraffic\b/u, /\broad\b/u],
    priority: 64,
    requiredSources: ["sim-search-data", "map-search"]
  },
  {
    allowedActions: ["focus-map"],
    answerContract: commonAnswerContract,
    description: "Aktivní požár, kouř, hotspot nebo požární riziko.",
    domain: "fire",
    evalTemplates: [
      "Hoří {location}?",
      "Je vidět kouř {location}?",
      "Ukaž požáry {location}.",
      "Je hlášen požární zásah {location}?",
      "Fire risk {location}."
    ],
    forbiddenActions: [],
    intentId: "fire.current.risk",
    patterns: [/\bpozar/u, /\bhori\b/u, /\bkour/u, /\bhotspot\b/u, /\bfire\b/u],
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
    patterns: [/\bvypad(?:ek|ku|ky|kem|cich)\b/u, /\belektr/u, /\bplyn/u, /\bvodovod/u, /\binfrastruktur/u, /\butility\b/u, /\boutage\b/u],
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
    allowedActions: ["open-chat"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["stav odeslání", "automatické opakování", "neduplikovat zprávu"],
      mustNotInvent: ["doručení bez serverového potvrzení", "přečtení bez receipt"]
    },
    description: "Čekající, neodeslané nebo duplicitně zobrazené zprávy a jejich bezpečné opakování.",
    domain: "chat",
    evalTemplates: [
      "Proč zpráva pořád čeká?",
      "Zpráva se neodeslala.",
      "Vidím odeslanou zprávu dvakrát.",
      "Mám stejnou zprávu poslat znovu?",
      "Message delivery status?"
    ],
    forbiddenActions: ["route"],
    intentId: "chat.delivery.status",
    patterns: [/\bzprav\w*\s+(?:porad\s+)?ceka\b/u, /\bneodesl/u, /\bzprav\w*\s+dvakrat\b/u, /\bstejn\w*\s+zprav\w*\s+poslat\s+znovu\b/u, /\bmessage\s+delivery\s+status\b/u],
    priority: 98,
    requiredSources: ["app-runtime", "chat-context"]
  },
  {
    allowedActions: ["open-chat", "settings"],
    answerContract: {
      ...commonAnswerContract,
      citeSources: false,
      mustMention: ["E2EE stav", "obnovovací klíč", "omezení dostupné historie"],
      mustNotInvent: ["dešifrovaný obsah", "uložení obnovovacího klíče na serveru"]
    },
    description: "Vysvětlení E2EE obnovy, nečitelných starších zpráv a obnovovacího klíče.",
    domain: "chat",
    evalTemplates: [
      "Proč nejdou dešifrovat staré zprávy?",
      "Kam vložit obnovovací klíč?",
      "Chat po mně znovu chce E2EE klíč.",
      "Proč vidím zašifrované zprávy?",
      "How do I recover encrypted messages?"
    ],
    forbiddenActions: ["route"],
    intentId: "chat.encryption.recovery",
    patterns: [/\bdesifr/u, /\bobnovovac\w*\s+klic/u, /\be2ee\b/u, /\bzasifrovan\w*\s+zprav/u, /\brecover\w*\s+encrypted\s+messages\b/u],
    priority: 110,
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
  return normalizeAiQueryText(value);
}
