import { describe, expect, it } from "vitest";
import { reviewedGeneralQuestion } from "./ai-router-reviewed-general.js";

describe("reviewed general Router questions", () => {
  it("builds fixed questions without copying user content", () => {
    const question = reviewedGeneralQuestion("flood_preparedness");
    expect(question).toContain("obecné zásady");
    expect(question).not.toContain("chatContext");
  });

  it("rejects arbitrary text, identities and unknown topics", () => {
    for (const value of ["flood_preparedness: Jan Novák", "jan@example.cz", "unknown", null, {}]) {
      expect(reviewedGeneralQuestion(value)).toBeUndefined();
    }
  });
});
