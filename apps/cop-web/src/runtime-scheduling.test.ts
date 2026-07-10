import { describe, expect, it, vi } from "vitest";
import {
  mapWithConcurrency,
  nextOfflineSnapshotPersistDelay,
  shouldLoadWeatherWebcamDetail,
  weatherWebcamDetailCandidateKey
} from "./runtime-scheduling";

describe("runtime scheduling", () => {
  it("settles the first offline snapshot quickly and throttles subsequent snapshots", () => {
    expect(nextOfflineSnapshotPersistDelay(0, 20_000)).toBe(400);
    expect(nextOfflineSnapshotPersistDelay(15_000, 20_000)).toBe(5_000);
    expect(nextOfflineSnapshotPersistDelay(5_000, 20_000)).toBe(400);
  });

  it("does not reload a completed or in-flight webcam detail", () => {
    expect(shouldLoadWeatherWebcamDetail(undefined)).toBe(true);
    expect(shouldLoadWeatherWebcamDetail("error")).toBe(true);
    expect(shouldLoadWeatherWebcamDetail("loading")).toBe(false);
    expect(shouldLoadWeatherWebcamDetail("ready")).toBe(false);
  });

  it("keeps the webcam batch key stable across equivalent live GeoJSON objects", () => {
    const first = weatherWebcamDetailCandidateKey([
      { detailUrl: "https://camera.test/1", key: "cam-1" },
      { detailUrl: "https://camera.test/2", key: "cam-2" }
    ]);
    const equivalent = weatherWebcamDetailCandidateKey([
      { detailUrl: "https://camera.test/2", key: "cam-2" },
      { detailUrl: "https://camera.test/1", key: "cam-1" }
    ]);

    expect(equivalent).toBe(first);
    expect(weatherWebcamDetailCandidateKey([{ detailUrl: "https://camera.test/3", key: "cam-3" }])).not.toBe(first);
  });

  it("caps concurrent detail work while preserving result order", async () => {
    let active = 0;
    let peak = 0;
    const mapper = vi.fn(async (value: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    await expect(mapWithConcurrency([1, 2, 3, 4, 5], 2, mapper)).resolves.toEqual([2, 4, 6, 8, 10]);
    expect(mapper).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });
});
