import { describe, expect, it } from "vitest";
import { AiSemanticRetriever, createSemanticDocuments } from "./ai-semantic-retrieval.js";
import { AiContextIndex } from "./ai-context-index.js";

describe("AiContextIndex", () => {
  it("queries a background COP index with geo and time filters", async () => {
    const index = new AiContextIndex();
    index.replaceDocuments(createSemanticDocuments({
      communityReports: [{
        category: "flood",
        description: "Stoupající hladina řeky u Vrbna.",
        location: { lat: 50.12, lon: 17.37 },
        observedAt: "2026-07-04T09:00:00.000Z",
        reportId: "report-vrbno-flood",
        severity: "warning",
        status: "submitted",
        title: "Hladina řeky"
      }, {
        category: "fire",
        description: "Kouř mimo filtrované území.",
        location: { lat: 49.2, lon: 15.1 },
        observedAt: "2026-07-04T09:00:00.000Z",
        reportId: "report-far-fire",
        severity: "warning",
        status: "submitted",
        title: "Kouř"
      }],
      sourceHealth: [{
        displayName: "SIM Safety Data",
        health: "ONLINE",
        sourceSystemId: "sim.safety-data",
        updatedAt: "2026-07-04T09:00:00.000Z"
      }]
    }), {
      indexedAt: new Date("2026-07-04T09:05:00.000Z"),
      reason: "test"
    });
    const retriever = new AiSemanticRetriever({
      embedText: async (input) => ({
        embedding: input.includes("hladina") || input.includes("řeky") ? [1, 0] : [0, 1],
        model: "bge-m3:latest"
      }),
      maxDocuments: 8
    });

    const context = await index.query(retriever, {
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      geo: {
        bbox: { east: 17.8, north: 50.4, south: 49.8, west: 17.0 },
        label: "Vrbno pod Pradědem",
        source: "geocoder"
      },
      query: "Jaká je situace ve Vrbně pod Pradědem?",
      timeWindow: {
        maxAgeSeconds: 6 * 3600
      }
    });

    expect(context).toMatchObject({
      contractVersion: "cop-ai-indexed-context-v1",
      index: {
        documentCount: 3,
        status: "ok"
      },
      semanticContext: {
        status: "ok"
      },
      toolCall: {
        candidateDocumentCount: 3,
        matchedDocumentCount: 2,
        mode: "read_only",
        toolId: "cop.ai.context_index.query"
      }
    });
    expect(context.semanticContext.items.map((item) => item.entityId)).toContain("report-vrbno-flood");
    expect(context.semanticContext.items.map((item) => item.entityId)).not.toContain("report-far-fire");
    expect(context.citations[0]?.citationId).toBe("I1");
  });

  it("marks empty matches without leaking unfiltered documents", async () => {
    const index = new AiContextIndex();
    index.replaceDocuments(createSemanticDocuments({
      incidents: [{
        incidentId: "incident-old",
        location: { lat: 50.1, lon: 17.3 },
        severity: "warning",
        status: "active",
        title: "Starší incident",
        updatedAt: "2026-07-01T10:00:00.000Z"
      }]
    }), {
      indexedAt: new Date("2026-07-04T09:05:00.000Z"),
      reason: "test"
    });
    const retriever = new AiSemanticRetriever({
      embedText: async () => ({
        embedding: [1, 0],
        model: "bge-m3:latest"
      })
    });

    const context = await index.query(retriever, {
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      query: "Co je aktuální?",
      timeWindow: {
        maxAgeSeconds: 3600
      }
    });

    expect(context.semanticContext.items).toEqual([]);
    expect(context.toolCall.matchedDocumentCount).toBe(0);
    expect(context.toolCall.warnings.join(" ")).toContain("matched no documents");
  });
});
