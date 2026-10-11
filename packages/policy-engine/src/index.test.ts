import { describe, expect, it } from "vitest";
import { defaultSystemSubject, evaluateReadPolicy } from "./index.js";

describe("canonical classification read policy", () => {
  it("retains access to unclassified tracks for the default system subject", () => {
    expect(evaluateReadPolicy(defaultSystemSubject(), { classification: "UNCLASSIFIED" }).allowed).toBe(true);
  });

  it.each(["RESTRICTED", "CONFIDENTIAL", "SECRET", "UNKNOWN"])("denies %s to the unclassified subject", (classification) => {
    expect(evaluateReadPolicy(defaultSystemSubject(), { classification })).toMatchObject({
      allowed: false, auditTags: ["ABAC_CLASSIFICATION_DENY"]
    });
  });

  it("permits an explicit appropriate clearance and still enforces the device boundary", () => {
    const subject = { roles: ["COP_OPERATOR"], clearance: "RESTRICTED", deviceTrusted: true };
    expect(evaluateReadPolicy(subject, { classification: "RESTRICTED" }).allowed).toBe(true);
    expect(evaluateReadPolicy({ ...subject, deviceTrusted: false }, { classification: "RESTRICTED" }).allowed).toBe(false);
  });
});
