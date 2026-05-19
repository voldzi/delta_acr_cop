// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { builtInViewProfiles, readViewProfiles, writeCustomViewProfiles, type ViewProfile } from "./view-profiles";

beforeEach(() => {
  installLocalStorageMock();
});

describe("view profiles", () => {
  it("keeps custom profiles scoped to the current operator", () => {
    const profile: ViewProfile = {
      description: "Custom UAV view",
      id: "custom-uav",
      name: "UAV custom",
      settings: {
        activeWorkspace: "data",
        refreshSeconds: 2,
        selectedLayer: "uav",
        showHistory: true
      }
    };

    writeCustomViewProfiles([profile], "operator-a");

    expect(readViewProfiles("operator-a").some((candidate) => candidate.id === "custom-uav")).toBe(true);
    expect(readViewProfiles("operator-b").some((candidate) => candidate.id === "custom-uav")).toBe(false);
    expect(readViewProfiles("operator-b").length).toBe(builtInViewProfiles.length);
  });
});

function installLocalStorageMock() {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value)
    }
  });
}
