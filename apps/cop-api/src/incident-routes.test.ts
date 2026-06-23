import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCommunityReportStore } from "./community-report-store.js";
import { InMemoryIncidentStore } from "./incident-store.js";
import { buildServer } from "./server.js";

const authHeaders = { authorization: "Bearer dev-lab-token" };

describe("incident and fusion routes", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("requires authentication for incident access", async () => {
    const app = buildServer({
      communityReportStore: new InMemoryCommunityReportStore(),
      incidentStore: new InMemoryIncidentStore(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/incidents"
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("builds fusion suggestions from reports and promotes them to incidents with tasks", async () => {
    const app = buildServer({
      communityReportStore: new InMemoryCommunityReportStore(),
      incidentStore: new InMemoryIncidentStore(),
      now: () => new Date("2026-05-20T12:00:00Z")
    });

    const firstReport = await createSubmittedReport(app, {
      description: "Voda rychle stoupá u mostu, průjezd je omezený.",
      lat: 50.075,
      lon: 14.438,
      observedAt: "2026-05-20T11:53:00Z",
      title: "Voda u mostu"
    });
    const secondReport = await createSubmittedReport(app, {
      description: "Další hlášení potvrzuje zaplavený podjezd poblíž mostu.",
      lat: 50.076,
      lon: 14.439,
      observedAt: "2026-05-20T11:57:00Z",
      title: "Zaplavený podjezd"
    });

    const suggestionsResponse = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/v1/incidents/fusion/suggestions?bbox=14.0,49.8,14.8,50.3"
    });
    expect(suggestionsResponse.statusCode).toBe(200);
    expect(suggestionsResponse.json()).toMatchObject({
      contractVersion: "cop-incident-fusion-suggestions-v1",
      sourceReportCount: 2
    });
    const suggestion = suggestionsResponse.json().items[0];
    expect(suggestion).toMatchObject({
      category: "flood",
      severity: "warning"
    });
    expect(suggestion.sourceRefs.map((ref: { id: string }) => ref.id).sort()).toEqual([firstReport.reportId, secondReport.reportId].sort());

    const incidentResponse = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        category: suggestion.category,
        confidence: suggestion.confidence,
        description: suggestion.description,
        location: suggestion.location,
        properties: {
          fusionSuggestionId: suggestion.suggestionId
        },
        severity: suggestion.severity,
        sourceRefs: suggestion.sourceRefs,
        status: "active",
        title: suggestion.title
      },
      url: "/api/v1/incidents"
    });
    expect(incidentResponse.statusCode).toBe(201);
    expect(incidentResponse.json()).toMatchObject({
      category: "flood",
      severity: "warning",
      sourceRefs: [
        { kind: "community_report" },
        { kind: "community_report" }
      ],
      status: "active"
    });
    const incident = incidentResponse.json() as { incidentId: string };

    const listResponse = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: "/api/v1/incidents?bbox=14.0,49.8,14.8,50.3"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      contractVersion: "cop-incidents-v1",
      featureCollection: {
        features: [
          {
            id: incident.incidentId,
            properties: {
              category: "flood",
              incidentId: incident.incidentId,
              kind: "incident",
              severity: "warning",
              status: "active"
            }
          }
        ]
      }
    });

    const taskResponse = await app.inject({
      headers: authHeaders,
      method: "POST",
      payload: {
        description: "Prověřit průjezdnost mostu a doplnit fotodokumentaci.",
        priority: "high",
        status: "open",
        title: "Prověřit průjezdnost"
      },
      url: `/api/v1/incidents/${incident.incidentId}/tasks`
    });
    expect(taskResponse.statusCode).toBe(201);
    expect(taskResponse.json()).toMatchObject({
      incidentId: incident.incidentId,
      priority: "high",
      status: "open",
      title: "Prověřit průjezdnost"
    });
    const task = taskResponse.json() as { taskId: string };

    const taskUpdateResponse = await app.inject({
      headers: authHeaders,
      method: "PATCH",
      payload: {
        status: "done"
      },
      url: `/api/v1/incidents/${incident.incidentId}/tasks/${task.taskId}`
    });
    expect(taskUpdateResponse.statusCode).toBe(200);
    expect(taskUpdateResponse.json()).toMatchObject({
      status: "done",
      taskId: task.taskId
    });

    const tasksResponse = await app.inject({
      headers: authHeaders,
      method: "GET",
      url: `/api/v1/incidents/${incident.incidentId}/tasks`
    });
    expect(tasksResponse.statusCode).toBe(200);
    expect(tasksResponse.json()).toMatchObject({
      contractVersion: "cop-incident-tasks-v1",
      items: [
        {
          status: "done",
          taskId: task.taskId
        }
      ]
    });

    await app.close();
  });
});

async function createSubmittedReport(
  app: ReturnType<typeof buildServer>,
  input: {
    description: string;
    lat: number;
    lon: number;
    observedAt: string;
    title: string;
  }
): Promise<{ reportId: string }> {
  const createResponse = await app.inject({
    headers: authHeaders,
    method: "POST",
    payload: {
      category: "flood",
      description: input.description,
      hazardSeverity: "warning",
      location: {
        accuracyM: 12,
        lat: input.lat,
        lon: input.lon,
        source: "device"
      },
      observedAt: input.observedAt,
      title: input.title,
      validUntil: "2026-05-20T18:00:00Z",
      visibility: "community"
    },
    url: "/api/v1/community/reports"
  });
  expect(createResponse.statusCode).toBe(201);
  const report = createResponse.json() as { reportId: string };

  const submitResponse = await app.inject({
    headers: authHeaders,
    method: "POST",
    url: `/api/v1/community/reports/${report.reportId}/submit`
  });
  expect(submitResponse.statusCode).toBe(200);

  return report;
}
