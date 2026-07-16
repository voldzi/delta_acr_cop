import { randomUUID } from "node:crypto";
import type { AiCopQuery, AiCopResponse } from "@cop/ai-gateway";

const technicalSummaryPatterns = [
  /\bMAX_Z\b/iu,
  /\bchmi_weather_radar\b/iu,
  /\bsim\.search-data\b/iu,
  /\b(?:contractVersion|mapFeatureId|providerId|sourceSystemId)\b/u,
  /\bM_UNKNOWN_TOKEN\b/u,
  /\b(?:ClientError|ErrorKind|stack trace)\b/iu,
  /\bAI provider (?:is temporarily unavailable|failed|timed out)\b/iu,
  /\b(?:undefined|null)\b/iu
];

const deterministicIntentIds = new Set([
  "cop.capabilities.help",
  "chat.delivery.status",
  "chat.encryption.recovery",
  "emergency.immediate.help",
  "report.create"
]);

export function shouldAnswerAiPlaybookDeterministically(aiRequest: AiCopQuery): boolean {
  const intentId = aiIntentId(aiRequest);
  return intentId !== undefined && deterministicIntentIds.has(intentId);
}

export function aiProviderResponseNeedsUserFacingFallback(response: AiCopResponse): boolean {
  if (response.status !== "COMPLETED") {
    return true;
  }
  const summary = optionalText(response.result.summary);
  if (!summary || summary.length < 8) {
    return true;
  }
  return technicalSummaryPatterns.some((pattern) => pattern.test(summary));
}

export function aiGroundedPlaybookResponse(
  aiRequest: AiCopQuery,
  requestNow: Date,
  reason: string
): AiCopResponse {
  const context = isRecord(aiRequest.context) ? aiRequest.context : {};
  const intentId = aiIntentId(aiRequest);
  const summary = groundedSummary(intentId, context, requestNow);
  return {
    auditId: randomUUID(),
    model: "grounded-playbook-v1",
    policy: {
      allowed: true,
      reason,
      redactionsApplied: false
    },
    provider: "local",
    requestId: aiRequest.requestId,
    result: {
      structured: {
        answerQuality: {
          fallbackApplied: true,
          intentId: intentId ?? "unclassified",
          userFacing: true
        },
        generatedAt: requestNow.toISOString()
      },
      summary
    },
    status: "COMPLETED"
  };
}

function groundedSummary(intentId: string | undefined, context: Record<string, unknown>, requestNow: Date): string {
  switch (intentId) {
    case "emergency.immediate.help":
      return [
        "Pokud je někdo v bezprostředním ohrožení života nebo bezpečnosti, volejte ihned 112; pro zdravotnickou pomoc 155, hasiče 150 a policii 158.",
        "Neohrožujte sebe, sdělte přesné místo, stručně popište situaci a řiďte se pokyny operátora.",
        "COP neumí potvrdit, že už byla pomoc vyslána."
      ].join(" ");
    case "cop.capabilities.help":
      return [
        "COP AI umí shrnout aktuální situaci, výstrahy, incidenty a viditelnou část chatu; vyhledat na mapě například policii, zdravotní pomoc, kryt, hydrologická měření nebo dopravní omezení; a odpovědět na otázky k počasí z dostupných COP/SIM dat.",
        "Může také pomoci připravit hlášení a vysvětlit stav datových zdrojů.",
        "Nevykonává nevratné akce bez potvrzení, nevidí nečitelnou historii a při chybějících datech to musí výslovně uvést.",
        "Zkuste například: „Jaké bude počasí u mě?“, „Kde je nejbližší policie?“ nebo „Shrň aktivní výstrahy“."
      ].join(" ");
    case "situation.summary":
      return situationSummary(context, requestNow);
    case "alerts.active":
      return alertsSummary(context, requestNow);
    case "community.reports.summary":
      return communityReportsSummary(context, requestNow);
    case "source.health":
      return sourceHealthSummary(context, requestNow);
    case "chat.conversation.summary":
      return chatContextSummary(context);
    case "chat.notification.status":
      return "COP AI nevidí systémové nastavení oznámení telefonu. Zkontrolujte v aplikaci stav synchronizace a nepřečtené konverzace a v Nastavení iOS povolení oznámení pro COP Mobile. Pokud se počty neshodují, ponechte aplikaci chvíli otevřenou kvůli dosynchronizaci.";
    case "chat.delivery.status":
      return "Stav „čeká“ znamená, že zpráva je uložená v telefonu a čeká na potvrzení serveru; „odesláno“ potvrzuje přijetí serverem a „přečteno“ se zobrazí jen při dostupném potvrzení protistrany. Stejnou zprávu neposílejte ručně znovu: COP Mobile má opakovat přenos automaticky a po potvrzení sloučit lokální a serverovou kopii. Pokud čekání trvá, ověřte připojení a otevřete detail diagnostiky chatu.";
    case "chat.encryption.recovery":
      return "Nečitelné starší zprávy obvykle znamenají, že toto zařízení nemá jejich E2EE šifrovací klíče. Obnovovací klíč se zadává pouze v nativním COP Mobile a nesmí se odesílat do chatu ani ukládat na COP/Matrix server. Po úspěšné obnově se doplní jen historie, pro kterou záloha skutečně obsahuje klíče; ostatní zprávy mohou zůstat nečitelné. Pokud aplikace žádá klíč opakovaně, jde o stav zařízení nebo relace, nikoli důvod vytvářet nový klíč.";
    case "pwa.offline.status":
      return "Web i COP Mobile uchovávají podporovaná data pro omezený offline provoz, ale živé mapové vrstvy, nové zprávy a AI odpovědi vyžadují spojení. Přihlášení a šifrovací stav nelze z této odpovědi ověřit; jejich skutečný stav zkontrolujte v nastavení aplikace.";
    case "app.location.permission":
      return "COP AI nečte polohu bez oprávnění. V iOS otevřete Nastavení → Soukromí a zabezpečení → Polohové služby → COP Mobile a povolte polohu při používání; poté se vraťte do mapy. Pokud přesná poloha není dostupná, zadejte obec nebo oblast ručně.";
    case "report.create":
      return "Mohu pomoci připravit hlášení, ale neodešlu jej bez vašeho potvrzení. Otevřete Nové hlášení, doplňte stručný popis, místo, čas a případnou fotografii; před odesláním zkontrolujte citlivé údaje a správnou viditelnost.";
    default:
      return intentId?.startsWith("weather.")
        ? "Pro požadované místo a období teď nemám v COP/SIM dostupnou ověřenou meteorologickou předpověď. Zadejte prosím obec nebo sdílejte polohu a upřesněte období, například „zítra odpoledne“."
        : "Teď nemám z dostupného COP kontextu dost ověřených podkladů pro spolehlivou odpověď. Upřesněte prosím místo, období nebo údaj, který chcete zjistit.";
  }
}

function situationSummary(context: Record<string, unknown>, requestNow: Date): string {
  const alerts = recordList(context.alerts);
  const incidents = recordList(context.incidents);
  const reports = recordList(context.communityReports);
  const items = [
    ...alerts.slice(0, 2).map((item) => labeledItem(item, "Výstraha")),
    ...incidents.slice(0, 2).map((item) => labeledItem(item, "Incident")),
    ...reports.slice(0, 1).map((item) => labeledItem(item, "Hlášení"))
  ].filter(Boolean);
  const timestamp = formatDateTime(requestNow);
  if (items.length === 0) {
    return `K ${timestamp} nejsou v aktuálně dostupném COP kontextu aktivní výstrahy, incidenty ani publikovaná hlášení. To není potvrzení, že je situace bez rizika; pokrytí může být neúplné nebo opožděné.`;
  }
  return [
    `K ${timestamp} eviduje dostupný COP kontext ${alerts.length} výstrah, ${incidents.length} incidentů a ${reports.length} komunitních hlášení.`,
    `Nejdůležitější dostupné položky: ${items.join("; ")}.`,
    "Výsledek zahrnuje pouze data, ke kterým má uživatel přístup, a nemusí pokrývat všechny zdroje."
  ].join(" ");
}

function alertsSummary(context: Record<string, unknown>, requestNow: Date): string {
  const alerts = recordList(context.alerts).filter((item) => optionalText(item.status)?.toUpperCase() !== "ACKNOWLEDGED");
  if (alerts.length === 0) {
    return `K ${formatDateTime(requestNow)} nejsou v dostupném COP kontextu žádné aktivní výstrahy. To neznamená nulové riziko; některý zdroj může být opožděný nebo mimo aktuální oblast.`;
  }
  const items = alerts.slice(0, 4).map((item) => labeledItem(item, "Výstraha")).filter(Boolean);
  return `K ${formatDateTime(requestNow)} jsou v dostupném COP kontextu ${alerts.length} aktivní výstrahy. ${items.join("; ")}. Ověřte jejich čas platnosti a zdroj v detailu mapy.`;
}

function communityReportsSummary(context: Record<string, unknown>, requestNow: Date): string {
  const reports = recordList(context.communityReports);
  if (reports.length === 0) {
    return `K ${formatDateTime(requestNow)} nejsou v dostupném kontextu žádná publikovaná komunitní hlášení. Soukromá nebo dosud neověřená hlášení se do výsledku nemusí zahrnout.`;
  }
  const items = reports.slice(0, 5).map((item) => labeledItem(item, "Hlášení")).filter(Boolean);
  return `K ${formatDateTime(requestNow)} je dostupných ${reports.length} komunitních hlášení. ${items.join("; ")}. Komunitní hlášení jsou uživatelské vstupy a před operačním rozhodnutím vyžadují ověření.`;
}

function sourceHealthSummary(context: Record<string, unknown>, requestNow: Date): string {
  const sources = recordList(context.sourceHealth);
  if (sources.length === 0) {
    return `K ${formatDateTime(requestNow)} nejsou v tomto požadavku dostupné diagnostické údaje o datových zdrojích. Nelze proto potvrdit jejich čerstvost ani úplnost.`;
  }
  const healthy = sources.filter(isHealthySource);
  const degraded = sources.filter((item) => !isHealthySource(item));
  const problemNames = degraded.slice(0, 4).map((item) => optionalText(item.displayName) ?? "nejmenovaný zdroj");
  return [
    `K ${formatDateTime(requestNow)} je ${healthy.length} z ${sources.length} dostupných zdrojů v normálním stavu.`,
    degraded.length > 0 ? `${degraded.length} zdrojů vyžaduje pozornost: ${problemNames.join(", ")}.` : "Žádný zdroj v dostupné diagnostice nehlásí zhoršený stav.",
    "Čerstvost jednotlivých vrstev se může lišit; pro rozhodnutí ověřte čas poslední aktualizace v detailu zdroje."
  ].join(" ");
}

function chatContextSummary(context: Record<string, unknown>): string {
  const chatContext = isRecord(context.chatContext) ? context.chatContext : {};
  const messages = recordList(chatContext.messages);
  if (messages.length === 0) {
    return "V tomto požadavku není dostupný žádný viditelný dešifrovaný výňatek chatu, takže konverzaci nemohu spolehlivě shrnout. COP AI nikdy nedoplňuje neviděnou ani nečitelnou historii.";
  }
  const latest = messages.slice(-5).map((item) => {
    const sender = optionalText(item.senderDisplayName) ?? optionalText(item.sender) ?? "Účastník";
    const body = truncate(optionalText(item.body) ?? optionalText(item.text) ?? "zpráva bez textu", 100);
    return `${sender}: ${body}`;
  });
  return `Vidím ${messages.length} dešifrovaných zpráv z poskytnutého výňatku. Poslední témata: ${latest.join("; ")}. Pro skutečné shrnutí hlavních závěrů je potřeba dostupný AI model; neviděnou historii nedoplňuji.`;
}

function labeledItem(item: Record<string, unknown>, fallback: string): string {
  const title = truncate(optionalText(item.title) ?? fallback, 120);
  const severity = userFacingSeverity(optionalText(item.severity));
  const status = userFacingStatus(optionalText(item.status));
  return [title, severity, status].filter(Boolean).join(" – ");
}

function isHealthySource(item: Record<string, unknown>): boolean {
  const health = (optionalText(item.health) ?? optionalText(item.status) ?? "").toUpperCase();
  return ["ACTIVE", "HEALTHY", "OK", "ONLINE"].includes(health);
}

function userFacingSeverity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  const translations: Record<string, string> = {
    CRITICAL: "kritická závažnost",
    HIGH: "vysoká závažnost",
    MEDIUM: "střední závažnost",
    LOW: "nízká závažnost"
  };
  return translations[normalized] ?? value;
}

function userFacingStatus(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  const translations: Record<string, string> = {
    ACTIVE: "aktivní",
    CANDIDATE: "čeká na ověření",
    MONITORING: "sledováno",
    PUBLISHED: "publikováno",
    SUBMITTED: "odesláno"
  };
  return translations[normalized] ?? value;
}

function aiIntentId(aiRequest: AiCopQuery): string | undefined {
  const context = isRecord(aiRequest.context) ? aiRequest.context : {};
  const playbook = isRecord(context.responsePlaybook) ? context.responsePlaybook : {};
  return optionalText(playbook.intentId);
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Prague",
    year: "numeric"
  }).format(value);
}
