import { afterEach, describe, expect, it, vi } from "vitest";
import { MissionArenaSourceAdapter } from "./mission-arena-source.js";

describe("MissionArenaSourceAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads Mission Arena export as presentation features without calculating score", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: "Bearer mission-token",
        "X-COP-Token": "mission-token"
      });
      return new Response(JSON.stringify(sampleMissionArenaExport()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new MissionArenaSourceAdapter({
      baseUrl: "https://missionarena.zeleznalady.cz/",
      cacheTtlMs: 5000,
      enabled: true,
      readToken: "mission-token",
      timeoutMs: 5000
    });

    const result = await adapter.fetchFeatures({
      bbox: { east: 15.8, north: 50.1, south: 49.4, west: 14.5 },
      layers: ["presentation.mission_arena"],
      limit: 20
    }, new Date("2026-05-26T05:08:00Z"));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://missionarena.zeleznalady.cz/api/cop/export");
    expect(result).toMatchObject({
      contractVersion: "cop-mission-arena-source-v1",
      source: {
        sourceId: "mission-arena-api",
        sourceType: "MISSION_ARENA_PRESENTATION"
      },
      summary: {
        featureCount: 3,
        missionStateCount: 1,
        taskStateCount: 1,
        teamStateCount: 1
      },
      type: "FeatureCollection"
    });
    expect(result.features.map((feature) => feature.properties.featureRole)).toEqual(["mission_state", "team_state", "task_state"]);
    expect(result.features[0]?.properties).toMatchObject({
      featureRole: "mission_state",
      label: "Datové domény N/V/T",
      layer: "mission_arena",
      layerId: "presentation.mission_arena",
      providerId: "csm.mission-arena",
      score: {
        information: 56,
        speed: 54
      },
      scoreDelta: {
        information: 3
      },
      teamScores: [
        {
          aggregate: 54,
          color: "#9be564",
          label: "Modří",
          teamId: "alfa"
        }
      ]
    });
    expect(result.features[1]?.properties).toMatchObject({
      aggregate: 54,
      featureRole: "team_state",
      teamColor: "#9be564",
      teamId: "alfa",
      teamLabel: "Modří"
    });
    expect(result.features[2]?.properties).toMatchObject({
      animation: {
        state: "active"
      },
      featureRole: "task_state",
      gameState: {
        pressure: 42
      },
      tasking: [
        {
          label: "Ověřit provider kontrakt.",
          priority: "urgent",
          toRole: "signals"
        }
      ],
      teamId: "alfa",
      teamLabel: "Modří"
    });
  });

  it("uses the export cache within the configured TTL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(sampleMissionArenaExport()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new MissionArenaSourceAdapter({
      baseUrl: "https://missionarena.zeleznalady.cz",
      cacheTtlMs: 5000,
      enabled: true,
      timeoutMs: 5000
    });
    const query = {
      bbox: { east: 16, north: 51, south: 49, west: 14 },
      layers: ["presentation.mission_arena" as const],
      limit: 20
    };

    await adapter.fetchFeatures(query, new Date("2026-05-26T05:08:00Z"));
    await adapter.fetchFeatures(query, new Date("2026-05-26T05:08:03Z"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function sampleMissionArenaExport() {
  return {
    contractVersion: "cop-provider-featurecollection-v1",
    features: [
      {
        geometry: {
          coordinates: [15.338, 49.743],
          type: "Point"
        },
        id: "mission:domain-routing",
        properties: {
          featureRole: "mission_state",
          generatedAt: "2026-05-26T05:07:25.279Z",
          integrationMode: "presentation",
          label: "Datové domény N/V/T",
          layerId: "presentation.mission_arena",
          missionId: "domain-routing",
          missionPackId: "data-domains-ieg",
          participantCount: 3,
          phase: "lobby",
          runtimeMode: "live",
          score: {
            information: 56,
            speed: 54
          },
          scoreDelta: {
            information: 3
          },
          story: {
            act: "Identifikujte datovou doménu."
          },
          teamScores: [
            {
              aggregate: 54,
              color: "#9be564",
              label: "Modří",
              rank: 1,
              teamId: "alfa"
            }
          ],
          voteCount: 2
        },
        type: "Feature"
      },
      {
        geometry: {
          coordinates: [14.9, 49.9],
          type: "Point"
        },
        id: "team:alfa",
        properties: {
          aggregate: 54,
          featureRole: "team_state",
          label: "Modří",
          layerId: "presentation.mission_arena",
          missionId: "domain-routing",
          teamColor: "#9be564",
          teamId: "alfa",
          teamLabel: "Modří"
        },
        type: "Feature"
      },
      {
        geometry: {
          coordinates: [20, 50],
          type: "Point"
        },
        id: "team:outside",
        properties: {
          featureRole: "team_state",
          layerId: "presentation.mission_arena",
          teamId: "outside",
          teamLabel: "Mimo výřez"
        },
        type: "Feature"
      },
      {
        geometry: {
          coordinates: [15.1, 49.88],
          type: "Point"
        },
        id: "task:alfa:signals",
        properties: {
          animation: {
            state: "active"
          },
          featureRole: "task_state",
          gameState: {
            pressure: 42
          },
          label: "Modří: Ověřit provider kontrakt.",
          layerId: "presentation.mission_arena",
          missionId: "domain-routing",
          tasking: [
            {
              label: "Ověřit provider kontrakt.",
              priority: "urgent",
              teamId: "alfa",
              toRole: "signals"
            }
          ],
          teamId: "alfa",
          teamScores: [
            {
              aggregate: 54,
              color: "#9be564",
              label: "Modří",
              teamId: "alfa"
            }
          ]
        },
        type: "Feature"
      }
    ],
    generatedAt: "2026-05-26T05:07:25.279Z",
    providerId: "csm.mission-arena"
  };
}
