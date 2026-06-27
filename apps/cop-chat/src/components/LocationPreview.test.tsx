// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StaticLocationMap, formatCoordinates } from "./LocationPreview";

describe("LocationPreview", () => {
  it("formats coordinates with stable precision", () => {
    expect(formatCoordinates({ lat: 50.129514, lon: 17.362974 })).toBe("50.12951, 17.36297");
  });

  it("renders an OSM tile background for the shared location", () => {
    const { container } = render(<StaticLocationMap location={{ lat: 50.12951, lon: 17.36297, source: "map" }} />);
    const tile = container.querySelector(".map-tile");
    expect(tile?.getAttribute("style")).toContain("tile.openstreetmap.org");
  });
});
