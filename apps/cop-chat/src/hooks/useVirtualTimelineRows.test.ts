// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixTimelineMessage } from "@cop/messaging/types";

import {
  computeVirtualTimelineWindow,
  preferredChatScrollBehavior,
  useVirtualTimelineRows,
  type TimelineRow
} from "./useVirtualTimelineRows";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it("coalesces rapid timeline scroll events into one animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    render(React.createElement(VirtualTimelineHarness, { sourceRows: rows(220) }));
    const canvas = screen.getByTestId("timeline-canvas");
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 640 });

    canvas.scrollTop = 2_800;
    fireEvent.scroll(canvas);
    canvas.scrollTop = 3_100;
    fireEvent.scroll(canvas);
    canvas.scrollTop = 3_400;
    fireEvent.scroll(canvas);

    expect(animationFrame).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("timeline-start").textContent).toBe("0");
    act(() => callbacks.shift()?.(16));
    expect(Number(screen.getByTestId("timeline-start").textContent)).toBeGreaterThan(0);
  });

  it("disables scripted smooth scrolling when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(preferredChatScrollBehavior()).toBe("auto");
  });
});

function VirtualTimelineHarness({ sourceRows }: { sourceRows: TimelineRow[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const virtualTimeline = useVirtualTimelineRows(sourceRows, containerRef);
  return React.createElement(
    "div",
    { "data-testid": "timeline-canvas", ref: containerRef },
    React.createElement("output", { "data-testid": "timeline-start" }, virtualTimeline.startIndex)
  );
}
