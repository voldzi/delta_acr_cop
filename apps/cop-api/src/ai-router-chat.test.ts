import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopAiRouterChatAdapter,
  CopRouterChatError,
  type CopRouterChatConfig,
  type CopRouterChatRequest,
  type ReviewedPublicAggregate
} from "./ai-router-chat.js";

const config: CopRouterChatConfig = {
  baseUrl: "http://ai-router-api:4050",
  token: "cop-dedicated-token-at-least-thirty-two-characters",
  userIdSecret: "stable-private-user-id-hmac-key-32-characters"
};

const aggregate: ReviewedPublicAggregate = {
  sourceId: "chmi_weather_stations",
  metricId: "station_count",
  regionCode: "CZ010",
  periodStart: "2026-09-24T00:00:00Z",
  periodEnd: "2026-09-25T00:00:00Z",
  value: 42,
  unit: "count",
  sampleSize: 42
};

function routerSuccess(tier: "local_fast" | "external_economy") {
  return new Response(
    JSON.stringify({
      requestId: "router-request-1",
      model: tier === "local_fast" ? "local-model" : "gpt-6-luna",
      tier,
      output: "Shrnutí pro lidskou kontrolu.",
      usage: { inputTokens: 21, outputTokens: 9, estimatedMicrousd: 5 },
      requiresHumanReview: true
    }),
    { status: 200 }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("staged COP chat Router boundary", () => {
  it("uses a stable opaque subject ID and only the typed synthetic context", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(routerSuccess("external_economy")));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CopAiRouterChatAdapter(config);
    const input = {
      kind: "synthetic" as const,
      actorSubjectId: "person@example.test",
      intent: "summarize" as const,
      scenario: { scenarioId: "exercise_42", facts: ["Fiktivní povodeň během cvičení."] }
    };
    expect((await adapter.generate(input)).model).toBe("gpt-6-luna");
    await adapter.generate(input);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(url.toString()).toBe("http://ai-router-api:4050/api/v1/ai-router/generate");
    expect(options.headers).toMatchObject({ authorization: `Bearer ${config.token}` });
    expect(body).toMatchObject({
      taskType: "cop_chat",
      dataClass: "synthetic",
      preference: "external",
      allowExternal: true,
      allowPaidEscalation: false,
      copContext: {
        contractVersion: "cop-chat-context-v1",
        dataClass: "synthetic",
        attestation: "cop-policy-reviewed-v1",
        scenarioId: "exercise_42",
        facts: ["Fiktivní povodeň během cvičení."]
      }
    });
    expect(body.userId).toMatch(/^cop_[A-Za-z0-9_-]{43}$/u);
    expect(body.userId).toBe(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).userId);
    expect(JSON.stringify(body)).not.toContain("person@example.test");
  });

  it("sends only validated numeric public aggregates and a fixed reviewed question", async () => {
    const fetchMock = vi.fn().mockResolvedValue(routerSuccess("external_economy"));
    vi.stubGlobal("fetch", fetchMock);
    await new CopAiRouterChatAdapter(config).generate({
      kind: "public_aggregate",
      actorSubjectId: "operator-123",
      intent: "compare",
      aggregates: [aggregate]
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.prompt).toContain("veřejné agregované hodnoty");
    expect(body.copContext.aggregates).toEqual([aggregate]);
    expect(Object.keys(body.copContext)).toEqual(["contractVersion", "dataClass", "attestation", "aggregates"]);
    expect(body.allowPaidEscalation).toBe(false);
  });

  it("keeps arbitrary user questions internal, without forwarding chat context or allowing external processing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(routerSuccess("local_fast"));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      kind: "internal" as const,
      actorSubjectId: "operator-123",
      question: "Co znamená tato zpráva?",
      chatContext: { privateMessage: "decrypted-secret" }
    };
    await new CopAiRouterChatAdapter(config).generate(input);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      dataClass: "internal",
      preference: "local",
      allowExternal: false,
      copContext: { contractVersion: "cop-chat-context-v1", dataClass: "internal" }
    });
    expect(JSON.stringify(body)).not.toContain("decrypted-secret");
  });

  it("sends reviewed internal items only to the local tier and rejects extra fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(routerSuccess("local_fast"));
    vi.stubGlobal("fetch", fetchMock);
    await new CopAiRouterChatAdapter(config).generate({
      kind: "internal", actorSubjectId: "operator-123", question: "Shrň viditelný kontext.",
      items: [{ kind: "chat_message", text: "Soukromá zpráva pro lokální model." }]
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ dataClass: "internal", preference: "local", allowExternal: false,
      copContext: { attestation: "cop-internal-reviewed-v1", items: [{ kind: "chat_message", text: "Soukromá zpráva pro lokální model." }] } });
    expect(() => new CopAiRouterChatAdapter(config)).not.toThrow();
    await expect(new CopAiRouterChatAdapter(config).generate({
      kind: "internal", actorSubjectId: "operator-123", question: "Test",
      items: [{ kind: "incident" as "chat_message", text: "Nepovolený typ." }]
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stages approved minimized internal questions without raw chat context or personal fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(routerSuccess("external_economy"));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CopAiRouterChatAdapter(config);
    await adapter.generate({
      kind: "internal_minimized", actorSubjectId: "operator-123",
      reviewedQuestion: "Jak se změnila dostupnost datových zdrojů?",
      externalApproval: true,
      items: [
        { kind: "source_health", sourceId: "weather_feed", status: "degraded" },
        { kind: "operational_metric", metricId: "source_count", regionCode: "CZ010", value: 42, unit: "count", sampleSize: 42 }
      ]
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ taskType: "cop_chat", dataClass: "internal_minimized", preference: "external",
      allowExternal: true, allowPaidEscalation: false,
      copContext: { contractVersion: "cop-chat-context-v1", dataClass: "internal_minimized",
        attestation: "cop-internal-minimized-reviewed-v1" } });
    expect(Object.keys(body.copContext)).toEqual(["contractVersion", "dataClass", "attestation", "items"]);
    expect(JSON.stringify(body)).not.toContain("operator-123");
    expect(body.copContext.items).toHaveLength(2);
  });

  it("rejects unapproved or expanded minimized internal requests before Router call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CopAiRouterChatAdapter(config);
    const input = { kind: "internal_minimized" as const, actorSubjectId: "operator-123",
      reviewedQuestion: "Jaký je stav?", externalApproval: true as const };
    await expect(adapter.generate({ ...input, externalApproval: false as true })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(adapter.generate({ ...input, chatContext: { messages: ["private"] } } as CopRouterChatRequest)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(adapter.generate({ ...input, items: [{ kind: "source_health", sourceId: "feed", status: "up", personName: "Private" }] as never })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(adapter.generate({ ...input, items: [{ kind: "operational_metric", metricId: "count", regionCode: "CZ010", value: 1, unit: "count", sampleSize: 1 }] })).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fall back for minimized internal questions when Router denies or fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "daily_budget_exceeded" }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "model_unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(routerSuccess("local_fast"));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CopAiRouterChatAdapter(config);
    const input = { kind: "internal_minimized" as const, actorSubjectId: "operator-123",
      reviewedQuestion: "Kolik zdrojů je dostupných?", externalApproval: true as const };
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "limit_reached" });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "router_unavailable" });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects unreviewed or identifiable context before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CopAiRouterChatAdapter(config);
    const badAggregate = { ...aggregate, sampleSize: 1, personName: "Private person" };
    await expect(
      adapter.generate({
        kind: "public_aggregate",
        actorSubjectId: "operator-123",
        intent: "summarize",
        aggregates: [badAggregate]
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      adapter.generate({
        kind: "synthetic",
        actorSubjectId: "operator-123",
        intent: "summarize",
        scenario: { scenarioId: "exercise_42", facts: ["ok"], chatMessage: "private" } as unknown as {
          scenarioId: string;
          facts: string[];
        }
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      adapter.generate({ kind: "internal", actorSubjectId: "operator-123", question: "x".repeat(1201) })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on limits, outages and unexpected model tiers", async () => {
    const input = {
      kind: "synthetic" as const,
      actorSubjectId: "operator-123",
      intent: "summarize" as const,
      scenario: { scenarioId: "exercise_42", facts: ["Fiktivní situace."] }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "daily_budget_exceeded" }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "model_unavailable" }), { status: 503 }))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(routerSuccess("local_fast"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            requestId: "router-request-2",
            model: "gpt-6-sol",
            tier: "external_economy",
            output: "wrong model",
            usage: { inputTokens: 1, outputTokens: 1, estimatedMicrousd: 1 },
            requiresHumanReview: true
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CopAiRouterChatAdapter(config);
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "limit_reached" });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "router_unavailable" });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "router_unavailable" });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(adapter.generate(input)).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(CopRouterChatError).toBeDefined();
  });

  it("does not retry an internal question through an external model when the local tier is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "local_model_unavailable" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new CopAiRouterChatAdapter(config).generate({
        kind: "internal",
        actorSubjectId: "operator-123",
        question: "Co je známo?"
      })
    ).rejects.toMatchObject({ code: "router_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ dataClass: "internal", preference: "local", allowExternal: false });
  });

  it("requires a dedicated token and a stable secret for opaque user IDs", () => {
    expect(() => new CopAiRouterChatAdapter({ ...config, token: "short" })).toThrow();
    expect(() => new CopAiRouterChatAdapter({ ...config, userIdSecret: "short" })).toThrow();
    expect(() => new CopAiRouterChatAdapter({ ...config, baseUrl: "https://example.test/path" })).toThrow();
  });
});
