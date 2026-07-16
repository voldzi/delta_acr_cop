import { describe, expect, it } from "vitest";
import { buildAiPromptContextCompression } from "./ai-context-compression.js";
import type { AiIndexedContext } from "./ai-context-index.js";
import type { AiSemanticContext } from "./ai-semantic-retrieval.js";

describe("buildAiPromptContextCompression", () => {
  it("keeps bge-m3 selected crisis evidence and drops routine stale air noise from the provider prompt", () => {
    const semanticContext = semanticContextFixture({
      citationPrefix: "S",
      items: [{
        entityId: "report-flood",
        entityType: "communityReport",
        text: "Stoupající hladina řeky u mostu ve Vrbně. ".repeat(30),
        title: "Stoupající hladina"
      }, {
        entityId: "flight-stale",
        entityType: "observedObject",
        text: "Routine stale civil flight track.",
        title: "Civilní let"
      }]
    });
    const indexedContext = indexedContextFixture(semanticContextFixture({
      citationPrefix: "I",
      items: [{
        entityId: "report-flood",
        entityType: "communityReport",
        text: "Index: hladina řeky u mostu.",
        title: "Stoupající hladina"
      }]
    }));

    const compressed = buildAiPromptContextCompression({
      alerts: [],
      communityReports: [{
        category: "flood",
        description: "Hladina řeky rychle stoupá u mostu.",
        location: { lat: 50.1, lon: 17.2 },
        reportId: "report-flood",
        severity: "warning",
        status: "submitted",
        title: "Stoupající hladina"
      }],
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      incidents: [],
      indexedContext,
      objects: [{
        dataQuality: "track_stale",
        domain: "air",
        objectId: "flight-stale",
        objectType: "aircraft",
        status: "ACTIVE",
        title: "Civilní let se starším trackem"
      }],
      priorityContext: {
        citations: [{
          citationId: "P1",
          entityId: "report-flood",
          entityType: "communityReport",
          label: "Stoupající hladina"
        }],
        prioritySignals: [{
          entityId: "report-flood",
          entityType: "communityReport",
          priorityScore: 0.9,
          title: "Stoupající hladina"
        }]
      },
      semanticContext,
      sourceHealth: []
    });

    expect(compressed.contextCompression).toMatchObject({
      contractVersion: "cop-ai-prompt-context-compression-v1",
      mode: "bge-m3-evidence-first",
      omittedCounts: {
        objects: 1
      },
      retrievalIntent: {
        primary: "general-safety",
        suppressRoutineCivilAir: true
      }
    });
    expect(compressed.communityReports).toHaveLength(1);
    expect(compressed.objects).toEqual([]);
    expect(compressed.semanticContext.items[0]?.text.length).toBeLessThanOrEqual(520);
    expect(compressed.semanticContext.items[0]).not.toHaveProperty("payload");
    expect(compressed.indexedContext.semanticContext.items[0]).not.toHaveProperty("payload");
  });

  it("compresses visible chat context to selected and crisis-relevant snippets", () => {
    const semanticContext = semanticContextFixture({
      citationPrefix: "S",
      items: [{
        entityId: "$flood",
        entityType: "chatMessage",
        text: "Jiří: hladina u mostu stoupá",
        title: "Jiří"
      }]
    });

    const compressed = buildAiPromptContextCompression({
      alerts: [],
      chatContext: {
        encrypted: true,
        messages: [{
          body: "Domluva na oběd.",
          eventId: "$lunch",
          senderDisplayName: "A",
          timestamp: "2026-07-04T09:00:00.000Z"
        }, {
          body: "Hladina u mostu stoupá a voda je na silnici.",
          eventId: "$flood",
          senderDisplayName: "Jiří",
          timestamp: "2026-07-04T09:05:00.000Z"
        }],
        roomId: "!room:cop.local",
        source: "browser-visible-decrypted-timeline",
        visibleMessageCount: 2
      },
      communityReports: [],
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      incidents: [],
      indexedContext: indexedContextFixture(semanticContextFixture({ citationPrefix: "I", items: [] })),
      objects: [],
      priorityContext: {},
      semanticContext,
      sourceHealth: []
    });

    expect(compressed.chatContext).toMatchObject({
      encrypted: true,
      includedMessageCount: 1,
      omittedMessageCount: 1
    });
    expect((compressed.chatContext?.messages as Record<string, unknown>[] | undefined)?.[0]).toMatchObject({
      eventId: "$flood"
    });
  });

  it("keeps the selected discussion window in chronological order", () => {
    const compressed = buildAiPromptContextCompression({
      alerts: [],
      chatContext: {
        messages: [
          { body: "Ve Vrbně stoupá voda.", eventId: "$older", timestamp: "2026-07-04T09:00:00.000Z" },
          { body: "Most je zatím průjezdný.", eventId: "$newer", timestamp: "2026-07-04T09:02:00.000Z" },
          { body: "Domluva na oběd.", eventId: "$unrelated", timestamp: "2026-07-04T09:03:00.000Z" }
        ]
      },
      communityReports: [],
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      incidents: [],
      indexedContext: indexedContextFixture(semanticContextFixture({ citationPrefix: "I", items: [] })),
      objects: [],
      priorityContext: {},
      requiredChatMessageIds: ["$newer", "$older"],
      semanticContext: semanticContextFixture({ citationPrefix: "S", items: [] }),
      sourceHealth: []
    });

    expect((compressed.chatContext?.messages as Record<string, unknown>[] | undefined)?.map((message) => message.eventId))
      .toEqual(["$older", "$newer"]);
  });
});

function semanticContextFixture(input: {
  citationPrefix: "I" | "S";
  items: Array<{
    entityId: string;
    entityType: "alert" | "chatMessage" | "communityReport" | "incident" | "observedObject" | "sourceHealth";
    text: string;
    title: string;
  }>;
}): AiSemanticContext {
  const items = input.items.map((item, index) => ({
    citation: {
      citationId: `${input.citationPrefix}${index + 1}`,
      entityId: item.entityId,
      entityType: item.entityType,
      label: item.title
    },
    documentId: `${item.entityType}:${item.entityId}`,
    entityId: item.entityId,
    entityType: item.entityType,
    payload: {
      raw: "payload should not be sent to provider prompt"
    },
    priorityScore: 0.4,
    score: 0.9,
    semanticScore: 0.5,
    text: item.text,
    title: item.title
  }));
  return {
    citations: items.map((item) => item.citation),
    contractVersion: "cop-ai-semantic-context-v1",
    generatedAt: "2026-07-04T10:00:00.000Z",
    includedDocumentCount: items.length,
    items,
    model: "bge-m3:latest",
    query: "Jaká je situace?",
    status: "ok",
    warnings: []
  };
}

function indexedContextFixture(semanticContext: AiSemanticContext): AiIndexedContext {
  return {
    citations: semanticContext.citations,
    contractVersion: "cop-ai-indexed-context-v1",
    generatedAt: "2026-07-04T10:00:00.000Z",
    index: {
      documentCount: semanticContext.items.length,
      refreshedAt: "2026-07-04T09:00:00.000Z",
      status: "ok"
    },
    query: {
      limit: 8,
      text: semanticContext.query
    },
    semanticContext,
    toolCall: {
      candidateDocumentCount: semanticContext.items.length,
      durationMs: 1,
      invocationId: "tool-call-1",
      matchedDocumentCount: semanticContext.items.length,
      mode: "read_only",
      status: "ok",
      toolId: "cop.ai.context_index.query",
      warnings: []
    }
  };
}
