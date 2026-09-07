// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMapFeatures, type MapFeatureQueryResponse, type SafetyFeatureCollectionResponse } from "./cop-data";
import {
  localSafetyBounds,
  localSafetyEmptyCopy,
  safetyCollectionIsCurrent,
  useLocalSafetyFeed
} from "./local-safety-feed";

vi.mock("./cop-data", () => ({ fetchMapFeatures: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function collection(): SafetyFeatureCollectionResponse {
  return {
    contractVersion: "cop-safety-source-v1",
    type: "FeatureCollection",
    features: [],
    generatedAt: new Date().toISOString(),
    source: { sourceId: "safety-data-api", sourceType: "PUBLIC_SAFETY_AGGREGATE" },
    sourceHealth: { health: "ONLINE", evaluatedAt: new Date().toISOString() },
    sources: [{ sourceId: "chmi_alerts", enabled: true }],
    warnings: [],
    query: { bbox: localSafetyBounds({ lat: 50, lon: 15 })!, layers: ["weather_alerts"], limit: 1000 },
    summary: {
      featureCount: 0,
      sourceCount: 1,
      staleFeatureCount: 0,
      advisoryCount: 0,
      warningCount: 0,
      criticalCount: 0
    }
  };
}
function response(): MapFeatureQueryResponse {
  return { safety: collection(), warnings: [] } as unknown as MapFeatureQueryResponse;
}
const options = {
  apiBase: "",
  enabled: true,
  online: true,
  visible: true,
  autoRefresh: true,
  layerIds: ["public.safety.weather_alerts"],
  location: { lat: 50, lon: 15 }
};

describe("truthful local safety monitoring", () => {
  it("never equates a missing location or missing data with safety", () => {
    expect(localSafetyEmptyCopy("location-required").badge).toBe("Poloha neurčena");
    for (const state of ["unavailable", "limited"] as const) {
      expect(localSafetyEmptyCopy(state)).toMatchObject({ badge: "Situace neověřena", tone: "warn" });
    }
    expect(localSafetyEmptyCopy("current").title).toContain("Nejde o potvrzení bezpečí");
  });
  it("rejects stale, degraded, incomplete and undated evidence", () => {
    const good = collection();
    expect(safetyCollectionIsCurrent(good, Date.now(), 300_000)).toBe(true);
    expect(safetyCollectionIsCurrent(good, Date.now() + 301_000, 300_000)).toBe(false);
    expect(safetyCollectionIsCurrent({ ...good, generatedAt: "unknown" }, Date.now(), 300_000)).toBe(false);
    expect(safetyCollectionIsCurrent({ ...good, warnings: ["Missing source"] }, Date.now(), 300_000)).toBe(false);
    expect(safetyCollectionIsCurrent({ ...good, sources: [] }, Date.now(), 300_000)).toBe(false);
    expect(
      safetyCollectionIsCurrent(
        { ...good, sources: [{ sourceId: "chmi_alerts", enabled: false }] },
        Date.now(),
        300_000
      )
    ).toBe(false);
    expect(
      safetyCollectionIsCurrent(
        { ...good, sourceHealth: { health: "STALE", evaluatedAt: good.generatedAt } },
        Date.now(),
        300_000
      )
    ).toBe(false);
  });
  it("requests safety data independently of the selected map layers", async () => {
    vi.mocked(fetchMapFeatures).mockResolvedValue(response());
    const { result, unmount } = renderHook(() => useLocalSafetyFeed(options));
    await waitFor(() => expect(result.current.state).toBe("current"));
    expect(fetchMapFeatures).toHaveBeenCalledWith(
      "",
      undefined,
      expect.objectContaining({ layerIds: options.layerIds, signal: expect.any(AbortSignal) })
    );
    unmount();
  });
  it("does not request position or data without a user location", () => {
    const { result, unmount } = renderHook(() => useLocalSafetyFeed({ ...options, location: null }));
    expect(result.current.state).toBe("location-required");
    expect(fetchMapFeatures).not.toHaveBeenCalled();
    unmount();
  });
  it("discards old-location evidence and aborts work when the user moves or leaves", async () => {
    vi.mocked(fetchMapFeatures)
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook(({ location }) => useLocalSafetyFeed({ ...options, location }), {
      initialProps: { location: options.location }
    });
    await waitFor(() => expect(result.current.state).toBe("current"));
    rerender({ location: { lat: 49, lon: 16 } });
    expect(result.current.collection).toBeNull();
    expect(result.current.state).toBe("loading");
    const signal = vi.mocked(fetchMapFeatures).mock.calls.at(-1)?.[2].signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
  it("limits waiting and exposes an unavailable upstream instead of hanging", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMapFeatures).mockImplementation(
      (_base, _token, request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    const { result, unmount } = renderHook(() => useLocalSafetyFeed(options));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.state).toBe("limited");
    unmount();
  });
  it("expires evidence even with automatic refresh disabled", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMapFeatures).mockResolvedValue(response());
    const { result, unmount } = renderHook(() => useLocalSafetyFeed({ ...options, autoRefresh: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("current");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360_000);
    });
    expect(result.current.state).toBe("limited");
    expect(fetchMapFeatures).toHaveBeenCalledTimes(1);
    unmount();
  });
  it("keeps advancing event expiration offline without additional requests", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMapFeatures).mockResolvedValue(response());
    const { result, rerender, unmount } = renderHook(({ online }) => useLocalSafetyFeed({ ...options, online }), {
      initialProps: { online: true }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const checkedAt = result.current.evaluatedAt;
    rerender({ online: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360_000);
    });
    expect(result.current.evaluatedAt).toBeGreaterThanOrEqual(checkedAt + 360_000);
    expect(result.current.state).toBe("unavailable");
    expect(fetchMapFeatures).toHaveBeenCalledTimes(1);
    unmount();
  });
  it("rechecks age immediately after returning from a hidden tab", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchMapFeatures)
      .mockResolvedValueOnce(response())
      .mockImplementation(() => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook(({ visible }) => useLocalSafetyFeed({ ...options, visible }), {
      initialProps: { visible: true }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ visible: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360_000);
    });
    rerender({ visible: true });
    expect(result.current.state).toBe("limited");
    unmount();
  });
  it("retains the last evidence after a failed refresh and labels it unverified", async () => {
    vi.useFakeTimers();
    const good = response();
    vi.mocked(fetchMapFeatures).mockResolvedValueOnce(good).mockRejectedValueOnce(new Error("offline"));
    const { result, unmount } = renderHook(() => useLocalSafetyFeed(options));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.collection).toBe(good.safety);
    expect(result.current.state).toBe("limited");
    unmount();
  });
});
