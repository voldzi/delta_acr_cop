import { describe, expect, it } from "vitest";
import { formatMatrixClientError } from "./matrixClient";

describe("Matrix client diagnostics", () => {
  it("turns browser network failures into actionable homeserver diagnostics", () => {
    const error = formatMatrixClientError(
      new TypeError("fetch failed: Load failed"),
      "https://msg.zeleznalady.cz",
      "založit chatovou místnost"
    );

    expect(error.message).toContain("prohlížeč se nedostal na Matrix server https://msg.zeleznalady.cz");
    expect(error.message).toContain("/_matrix/client/versions");
  });

  it("keeps Matrix protocol errors unchanged", () => {
    const source = new Error("M_FORBIDDEN");

    expect(formatMatrixClientError(source, "https://msg.zeleznalady.cz", "odeslat zprávu")).toBe(source);
  });
});
