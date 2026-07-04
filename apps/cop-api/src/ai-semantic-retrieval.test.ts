import { describe, expect, it, vi } from "vitest";
import { AiSemanticRetriever, createSemanticDocuments } from "./ai-semantic-retrieval.js";

describe("AiSemanticRetriever", () => {
  it("ranks policy-filtered COP documents with the embedding provider", async () => {
    const embedText = vi.fn(async (input: string) => ({
      embedding: input.includes("most") || input.includes("bridge") ? [1, 0] : [0, 1],
      model: "bge-m3:latest"
    }));
    const retriever = new AiSemanticRetriever({
      embedText,
      maxDocuments: 3
    });

    const context = await retriever.retrieve({
      documents: createSemanticDocuments({
        alerts: [{
          alertId: "alert-flood",
          detail: "Stoupající hladina u mostu.",
          severity: "warning",
          title: "Most pod dohledem"
        }],
        incidents: [{
          description: "Výpadek elektřiny v centru.",
          incidentId: "incident-power",
          severity: "advisory",
          title: "Elektřina"
        }]
      }),
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      query: "Co se děje u mostu?"
    });

    expect(context).toMatchObject({
      includedDocumentCount: 2,
      model: "bge-m3:latest",
      status: "ok"
    });
    expect(context.items[0]).toMatchObject({
      entityId: "alert-flood",
      entityType: "alert",
      title: "Most pod dohledem"
    });
    expect(embedText).toHaveBeenCalled();
  });

  it("includes visible decrypted chat messages as consent-scoped semantic documents", () => {
    const documents = createSemanticDocuments({
      chatContext: {
        encrypted: true,
        messages: [{
          body: "Dobrovolníci posílají fotku zaplavené silnice.",
          eventId: "$event1",
          own: false,
          senderDisplayName: "Jiří Volek",
          timestamp: "2026-07-04T10:02:00.000Z"
        }],
        roomId: "!room:cop.local"
      }
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      documentId: "chatMessage:$event1",
      entityType: "chatMessage",
      metadata: {
        encrypted: true,
        roomId: "!room:cop.local",
        sender: "Jiří Volek"
      }
    });
  });

  it("boosts crisis evidence over routine stale civil air tracks", async () => {
    const retriever = new AiSemanticRetriever({
      embedText: async () => ({
        embedding: [1, 0],
        model: "bge-m3:latest"
      }),
      maxDocuments: 4
    });

    const context = await retriever.retrieve({
      documents: createSemanticDocuments({
        communityReports: [{
          category: "flood",
          description: "Hladina řeky rychle stoupá u mostu.",
          location: { lat: 50.1, lon: 17.2 },
          reportId: "report-flood",
          severity: "warning",
          status: "submitted",
          title: "Stoupající hladina"
        }],
        objects: [{
          dataQuality: "track_stale",
          domain: "air",
          objectId: "flight-stale",
          objectType: "aircraft",
          status: "ACTIVE",
          title: "Civilní let se starším trackem"
        }]
      }),
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      query: "Co je teď důležité v okolí?"
    });

    expect(context.items[0]).toMatchObject({
      entityId: "report-flood",
      entityType: "communityReport"
    });
    expect(context.items[0]?.priorityScore).toBeGreaterThan(context.items[1]?.priorityScore ?? 0);
    expect(context.items[0]?.citation).toMatchObject({
      citationId: "S1",
      position: { lat: 50.1, lon: 17.2 }
    });
    expect(context.citations[0]?.entityId).toBe("report-flood");
  });

  it("returns degraded context when embeddings are unavailable", async () => {
    const retriever = new AiSemanticRetriever({
      embedText: async () => {
        throw new Error("embedding unavailable");
      }
    });

    const context = await retriever.retrieve({
      documents: createSemanticDocuments({
        alerts: [{
          alertId: "alert-1",
          detail: "Test",
          title: "Alert"
        }]
      }),
      generatedAt: new Date("2026-07-04T10:00:00.000Z"),
      query: "Test"
    });

    expect(context.status).toBe("degraded");
    expect(context.items).toEqual([]);
    expect(context.warnings.join(" ")).toContain("embedding unavailable");
  });
});
