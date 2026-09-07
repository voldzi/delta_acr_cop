// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SituationFeature } from "./cop-data";
import { filterLocalSafetyFeatures, SafetyAlertBoard } from "./main";

afterEach(cleanup);
const now = Date.parse("2026-09-05T10:00:00Z");
const hazard: SituationFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [14.438, 50.076] },
  properties: {
    category: "fire",
    featureId: "fire-near",
    layer: "fire",
    label: "Požár u cesty",
    severity: "critical",
    sourceId: "nasa_firms",
    tags: { dataSource: "safety-data" },
    validUntil: "2026-09-05T11:00:00Z"
  }
};

describe("local alert workflow", () => {
  it("uses the same nearby, unexpired public events for the list and priority banner", () => {
    const far = { ...hazard, geometry: { type: "Point" as const, coordinates: [17.65, 49.22] as [number, number] } };
    const expired = { ...hazard, properties: { ...hazard.properties, validUntil: "2026-09-05T09:00:00Z" } };
    const features = [hazard, far, expired];
    expect(filterLocalSafetyFeatures(features, { lat: 50.0755, lon: 14.4378 }, now)).toEqual([hazard]);
    expect(filterLocalSafetyFeatures(features, null, now)).toEqual([]);
  });
  it("does not present an empty unavailable source as an absence of alerts", () => {
    render(<SafetyAlertBoard features={[]} evidenceState="unavailable" onSelectFeature={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("nelze spolehlivě ověřit");
    expect(screen.queryByText(/Žádné aktivní/)).toBeNull();
  });
  it("opens details using a human-readable action and keeps stale evidence labelled", () => {
    const select = vi.fn();
    render(<SafetyAlertBoard features={[hazard]} evidenceState="limited" onSelectFeature={select} />);
    expect(screen.getByRole("status").textContent).toContain("nelze spolehlivě ověřit");
    fireEvent.click(screen.getByRole("button", { name: "Zobrazit detail výstrahy" }));
    expect(select).toHaveBeenCalledWith("fire-near");
  });
});
