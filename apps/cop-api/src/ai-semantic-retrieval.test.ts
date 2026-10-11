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
    expect(context.retrievalIntent).toMatchObject({
      primary: "general-safety",
      suppressRoutineCivilAir: true
    });
    expect(context.items[0]?.priorityScore).toBeGreaterThan(context.items[1]?.priorityScore ?? 0);
    expect(context.items[1]?.priorityScore).toBeLessThan(-0.4);
    expect(context.items[0]?.citation).toMatchObject({
      citationId: "S1",
      position: { lat: 50.1, lon: 17.2 }
    });
    expect(context.citations[0]?.entityId).toBe("report-flood");
  });

  it("does not suppress routine civil air when the question is explicitly about air situation", async () => {
    const retriever = new AiSemanticRetriever({
      embedText: async () => ({
        embedding: [1, 0],
        model: "bge-m3:latest"
      }),
      maxDocuments: 2
    });

    const context = await retriever.retrieve({
      documents: createSemanticDocuments({
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
      query: "Jaká je letecká situace a pohyb letadel?"
    });

    expect(context.retrievalIntent).toMatchObject({
      primary: "air",
      suppressRoutineCivilAir: false
    });
    expect(context.items[0]).toMatchObject({
      entityId: "flight-stale",
      entityType: "observedObject"
    });
    expect(context.items[0]?.priorityScore).toBeGreaterThan(-0.1);
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

describe("semantic retrieval cancellation", () => {
  const documents = Array.from({ length: 12 }, (_, index) => ({ documentId: `d${index}`, entityId: `e${index}`, entityType: "incident" as const, text: `Synthetic incident ${index}` }));

  it("aborts concurrent embedding work and starts no more documents after the total deadline", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const embedText = vi.fn(async (_input: string, signal?: AbortSignal) => {
        if (embedText.mock.calls.length === 1) return { embedding: [1, 0], model: "test" };
        signals.push(signal!);
        return new Promise<{ embedding: number[]; model: string }>((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        });
      });
      const retriever = new AiSemanticRetriever({ embedText, timeoutMs: 50 });
      const outcome = retriever.retrieve({ documents, generatedAt: new Date(), query: "synthetic query" });
      await vi.advanceTimersByTimeAsync(50);
      expect(await outcome).toMatchObject({ status: "degraded", items: [] });
      expect(embedText).toHaveBeenCalledTimes(5);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      await vi.advanceTimersByTimeAsync(200);
      expect(embedText).toHaveBeenCalledTimes(5);
    } finally { vi.useRealTimers(); }
  });

  it("does not cache late embeddings from an abandoned request", async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: { embedding: number[]; model: string }) => void;
      const embedText = vi.fn(async () => new Promise<{ embedding: number[]; model: string }>((resolve) => { finish = resolve; }));
      const retriever = new AiSemanticRetriever({ embedText, timeoutMs: 50 });
      const input = { documents, generatedAt: new Date(), query: "synthetic query" };
      const first = retriever.retrieve(input);
      await vi.advanceTimersByTimeAsync(50);
      expect((await first).status).toBe("degraded");
      finish({ embedding: [1, 0], model: "late" });
      await vi.advanceTimersByTimeAsync(0);
      const second = retriever.retrieve(input);
      await vi.advanceTimersByTimeAsync(50);
      expect((await second).status).toBe("degraded");
      expect(embedText).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
