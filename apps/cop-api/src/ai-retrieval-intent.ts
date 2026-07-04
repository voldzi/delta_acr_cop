export type AiRetrievalIntentCategory =
  | "air"
  | "fire"
  | "flood-water"
  | "general-safety"
  | "infrastructure"
  | "medical"
  | "security-police"
  | "traffic"
  | "weather";

export interface AiRetrievalIntent {
  airRelevant: boolean;
  categories: AiRetrievalIntentCategory[];
  contractVersion: "cop-ai-retrieval-intent-v1";
  matchedTerms: string[];
  primary: AiRetrievalIntentCategory;
  queryExpansion: string;
  suppressRoutineCivilAir: boolean;
}

const categoryRules: Array<{
  category: Exclude<AiRetrievalIntentCategory, "general-safety">;
  expansion: string;
  pattern: RegExp;
}> = [{
  category: "flood-water",
  expansion: "povodeň voda hladina řeky hydrologie záplava most průtok varování SPA",
  pattern: /(povod|záplav|zaplav|vod|řek|řece|reka|rek|hladin|hydro|průtok|prutok|spa|most|flood|water|river)/iu
}, {
  category: "fire",
  expansion: "požár kouř hotspot FIRMS hasiči evakuace riziko šíření",
  pattern: /(požár|pozar|hoří|hori|kouř|kour|hasič|hasic|hotspot|firms|fire|smoke)/iu
}, {
  category: "security-police",
  expansion: "policie bezpečnost incident krádež zloděj pátrání podezřelý hlídka",
  pattern: /(polic|bezpeč|bezpec|kráde|krade|zlod|pátr|patr|podezř|podezr|hlídk|hlidk|crime|security)/iu
}, {
  category: "traffic",
  expansion: "doprava uzavírka nehoda silnice železnice kolona průjezdnost omezení",
  pattern: /(doprav|nehod|uzavír|uzavir|silnic|železn|zelezn|kolon|průjezd|prujezd|traffic|road)/iu
}, {
  category: "infrastructure",
  expansion: "infrastruktura výpadek elektřina voda plyn most komunikace sítě zásobování",
  pattern: /(infrastruktur|výpad|vypad|elektř|elektr|plyn|vodovod|most|komunikac|síť|sítě|sítí|zásob|zasob|outage|utility)/iu
}, {
  category: "medical",
  expansion: "zdravotní riziko zranění nemocnice evakuace nebezpečí pomoc obyvatelstvu",
  pattern: /(zdravot|zran|nemocnic|evaku|nebezpe|hazard|medical|injur)/iu
}, {
  category: "weather",
  expansion: "počasí výstraha bouřka vítr srážky teplota meteorologie",
  pattern: /(počas|pocas|výstrah|vystrah|bouř|bour|vítr|vitr|sráž|sraz|weather|storm|wind)/iu
}, {
  category: "air",
  expansion: "letecká situace letadla vzdušný prostor track letiště letový provoz",
  pattern: /(leteck|letadl|letový|letovy|letů|letu|vzdušn|vzdusn|aircraft|flight|airport|aviation|airspace|uav|drone|dron)/iu
}];

const generalSafetyExpansion = [
  "situační přehled",
  "priorita bezpečnost lidí a majetku",
  "povodeň voda hladina řeky",
  "požár kouř",
  "zdravotní riziko",
  "infrastruktura výpadek",
  "dopravní omezení",
  "bezpečnost policie incident",
  "komunitní hlášení aktivní výstrahy"
].join(" ");

export function inferAiRetrievalIntent(question: string): AiRetrievalIntent {
  const normalizedQuestion = question.replace(/\s+/gu, " ").trim();
  const matched = categoryRules
    .filter((rule) => rule.pattern.test(normalizedQuestion))
    .map((rule) => rule.category);
  const categories = uniqueCategories(matched.length > 0 ? matched : ["general-safety"]);
  const primary = categories.includes("general-safety")
    ? "general-safety"
    : categories[0] ?? "general-safety";
  const airRelevant = categories.includes("air");
  return {
    airRelevant,
    categories,
    contractVersion: "cop-ai-retrieval-intent-v1",
    matchedTerms: matchedTerms(normalizedQuestion),
    primary,
    queryExpansion: queryExpansionForCategories(categories),
    suppressRoutineCivilAir: !airRelevant
  };
}

export function buildAiRetrievalQuery(question: string, intent: AiRetrievalIntent): string {
  return [
    question.trim(),
    `retrievalIntent=${intent.primary}`,
    `categories=${intent.categories.join(",")}`,
    `focus=${intent.queryExpansion}`,
    intent.suppressRoutineCivilAir ? "routine civil air tracks are low priority unless directly safety relevant" : "air situation is explicitly relevant"
  ].filter(Boolean).join("\n");
}

export function aiIntentSuppressesRoutineCivilAir(intent: AiRetrievalIntent | undefined): boolean {
  return intent?.suppressRoutineCivilAir !== false;
}

export function isRoutineCivilAirText(text: string): boolean {
  const normalized = text.toLocaleLowerCase("cs-CZ");
  const air = /(aircraft|flight|letadl|leteck|letový|letovy|civil.*flight|public.*flight|track_stale|stale track)/u.test(normalized)
    || /(^|\W)air(\W|$)/u.test(normalized);
  if (!air) {
    return false;
  }
  return !/(critical|kritick|warning|výstrah|vystrah|incident|conflict|koliz|lost|polic|požár|pozar|povod|flood|hazard|evaku)/u.test(normalized);
}

function queryExpansionForCategories(categories: AiRetrievalIntentCategory[]): string {
  if (categories.includes("general-safety")) {
    return generalSafetyExpansion;
  }
  return categoryRules
    .filter((rule) => categories.includes(rule.category))
    .map((rule) => rule.expansion)
    .join(" ");
}

function uniqueCategories(values: AiRetrievalIntentCategory[]): AiRetrievalIntentCategory[] {
  return Array.from(new Set(values));
}

function matchedTerms(question: string): string[] {
  const terms: string[] = [];
  for (const rule of categoryRules) {
    if (rule.pattern.test(question)) {
      terms.push(rule.category);
    }
  }
  if (terms.length === 0 && /(situational awareness|situač|situac|přehled|prehled|stav|situace)/iu.test(question)) {
    terms.push("general-safety");
  }
  return Array.from(new Set(terms)).slice(0, 12);
}
