import { describe, expect, it } from "vitest";
import type { MatrixTimelineMessage } from "@cop/messaging/types";

import { computeVirtualTimelineWindow, type TimelineRow } from "./useVirtualTimelineRows";

function message(index: number): MatrixTimelineMessage {
  return {
    body: `Zpráva ${index}`,
    eventId: `$evt-${index}`,
    kind: "text",
    own: index % 2 === 0,
    sender: index % 2 === 0 ? "@alice:cop.local" : "@bob:cop.local",
    timestamp: `2026-06-26T08:${String(index % 60).padStart(2, "0")}:00.000Z`
  };
}

function rows(count: number): TimelineRow[] {
  return Array.from({ length: count }, (_, index) => ({
    grouped: index > 0,
    kind: "message",
    message: message(index)
  }));
}

describe("computeVirtualTimelineWindow", () => {
  it("keeps small timelines unvirtualized", () => {
    const sourceRows = rows(20);
    const window = computeVirtualTimelineWindow({ clientHeight: 640, rows: sourceRows, scrollTop: 0 });

    expect(window.enabled).toBe(false);
    expect(window.rows).toHaveLength(sourceRows.length);
  });

  it("returns a centered window and spacer sizes for long timelines", () => {
    const sourceRows = rows(220);
    const window = computeVirtualTimelineWindow({ clientHeight: 640, rows: sourceRows, scrollTop: 3_400 });

    expect(window.enabled).toBe(true);
    expect(window.startIndex).toBeGreaterThan(0);
    expect(window.endIndex).toBeLessThan(sourceRows.length);
    expect(window.rows.length).toBeLessThan(sourceRows.length);
    expect(window.paddingTop).toBeGreaterThan(0);
    expect(window.paddingBottom).toBeGreaterThan(0);
  });
});
