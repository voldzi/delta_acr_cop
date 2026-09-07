import { describe, expect, it } from "vitest";
import { rateWebMetric } from "./web-performance";

describe("web performance release ratings", () => {
  it("uses Core Web Vitals thresholds for user interactions", () => {
    expect(rateWebMetric("INP", 150)).toBe("good");
    expect(rateWebMetric("INP", 350)).toBe("needs-improvement");
    expect(rateWebMetric("INP", 750)).toBe("poor");
  });

  it("flags long main-thread tasks before they become visible hangs", () => {
    expect(rateWebMetric("LONG_TASK", 80)).toBe("good");
    expect(rateWebMetric("LONG_TASK", 180)).toBe("needs-improvement");
    expect(rateWebMetric("LONG_TASK", 300)).toBe("poor");
  });

  it("rates layout stability independently from timing metrics", () => {
    expect(rateWebMetric("CLS", 0.08)).toBe("good");
    expect(rateWebMetric("CLS", 0.2)).toBe("needs-improvement");
    expect(rateWebMetric("CLS", 0.4)).toBe("poor");
  });
});
