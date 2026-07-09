import { describe, expect, it } from "vitest";

import { isStalePwaReleaseError } from "./pwa-release.js";

describe("PWA release recovery", () => {
  it("recognizes browser lazy-chunk failures", () => {
    expect(
      isStalePwaReleaseError(new Error("Failed to fetch dynamically imported module: /assets/CopMap-old.js"))
    ).toBe(true);
    expect(isStalePwaReleaseError(new Error("Loading chunk CopMap failed"))).toBe(true);
    expect(isStalePwaReleaseError(new Error("Importing a module script failed"))).toBe(true);
  });

  it("does not treat ordinary runtime failures as stale releases", () => {
    expect(isStalePwaReleaseError(new Error("Routing service returned 400"))).toBe(false);
  });
});
