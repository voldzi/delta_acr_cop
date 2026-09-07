// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { DataAvailabilityNotice, dataAvailabilityCopy, mapUnavailableMessage } from "./data-availability";

describe("data availability", () => {
  it("turns a gateway failure into a user-facing recovery state", () => {
    const copy = dataAvailabilityCopy("502 API request failed for /health/ready");
    expect(copy.title).toBe("Živá data se právě obnovují");
    expect(copy.message).toContain("Poslední dostupná data");
    expect(copy.message).not.toContain("502");
    expect(copy.technicalDetail).toContain("/health/ready");
  });

  it("keeps the map message free of transport details", () => {
    expect(mapUnavailableMessage("NetworkError: fetch /api/v1/sources failed")).toBe(
      "Aplikace spojení obnoví automaticky."
    );
  });

  it("hides the technical detail behind an expandable disclosure", () => {
    render(<DataAvailabilityNotice error="503 API request failed for /api/v1/sources" />);
    expect(screen.getByText("Živá data se právě obnovují")).toBeTruthy();
    expect(screen.getByText("Podrobnosti pro správce")).toBeTruthy();
    expect(screen.getByText(/503 API request failed/).closest("details")).toBeTruthy();
  });
});
