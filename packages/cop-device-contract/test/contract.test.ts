import { describe, expect, it } from "vitest";
import { validateContractFixtures } from "../scripts/validate-fixtures";

describe("COP Device contract fixtures", () => {
  it("accepts all valid fixtures and rejects all invalid fixtures", () => {
    expect(validateContractFixtures()).toEqual([]);
  });
});
