import * as React from "react";
import type { MatrixTimelineMessage } from "@cop/messaging/types";

export type TimelineRow =
  { id: string; kind: "date"; label: string } | { grouped: boolean; kind: "message"; message: MatrixTimelineMessage };

const timelineVirtualizationThreshold = 80;
const timelineVirtualizationOverscan = 10;

export interface VirtualTimelineWindow {
  enabled: boolean;
  endIndex: number;
  paddingBottom: number;
  paddingTop: number;
  rows: TimelineRow[];
  scrollToRow(index: number, block?: "center" | "end" | "start"): void;
  startIndex: number;
}

interface VirtualTimelineWindowInput {
  clientHeight: number;
  overscan?: number;
  rows: TimelineRow[];
  scrollTop: number;
  threshold?: number;
}

interface ComputedVirtualTimelineWindow {
  enabled: boolean;
  endIndex: number;
  paddingBottom: number;
  paddingTop: number;
  rows: TimelineRow[];
  startIndex: number;
}

export function useVirtualTimelineRows(
  rows: TimelineRow[],
  containerRef: React.RefObject<HTMLElement | null>
): VirtualTimelineWindow {
  const [viewport, setViewport] = React.useState({ clientHeight: 0, scrollTop: 0 });
  const enabled = rows.length > timelineVirtualizationThreshold;
  const heights = React.useMemo(() => rows.map(estimateTimelineRowHeight), [rows]);
  const offsets = React.useMemo(() => {
    const nextOffsets = new Array<number>(heights.length + 1);
    nextOffsets[0] = 0;
    heights.forEach((height, index) => {
      nextOffsets[index + 1] = (nextOffsets[index] ?? 0) + height;
    });
    return nextOffsets;
  }, [heights]);

  const refreshViewport = React.useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    setViewport((current) => {
      const next = { clientHeight: node.clientHeight, scrollTop: node.scrollTop };
      return current.clientHeight === next.clientHeight && current.scrollTop === next.scrollTop ? current : next;
    });
  }, [containerRef]);

  React.useLayoutEffect(() => {
    refreshViewport();
  }, [refreshViewport, rows.length]);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    node.addEventListener("scroll", refreshViewport, { passive: true });
    return () => node.removeEventListener("scroll", refreshViewport);
  }, [containerRef, refreshViewport]);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => refreshViewport());
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef, refreshViewport]);

  const scrollToRow = React.useCallback(
    (index: number, block: "center" | "end" | "start" = "center") => {
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const rowStart = offsets[Math.max(0, Math.min(index, rows.length - 1))] ?? 0;
      const rowHeight = heights[Math.max(0, Math.min(index, heights.length - 1))] ?? 52;
      const nextTop =
        block === "start"
          ? rowStart
          : block === "end"
            ? rowStart + rowHeight - node.clientHeight
            : rowStart - Math.max(0, (node.clientHeight - rowHeight) / 2);
      node.scrollTo({ behavior: "smooth", top: Math.max(0, nextTop) });
    },
    [containerRef, heights, offsets, rows.length]
  );

  if (!enabled) {
    return { enabled: false, endIndex: rows.length, paddingBottom: 0, paddingTop: 0, rows, scrollToRow, startIndex: 0 };
  }

  return {
    ...computeVirtualTimelineWindow({
      clientHeight: viewport.clientHeight,
      overscan: timelineVirtualizationOverscan,
      rows,
      scrollTop: viewport.scrollTop,
      threshold: timelineVirtualizationThreshold
    }),
    scrollToRow
  };
}

export function computeVirtualTimelineWindow({
  clientHeight,
  overscan = timelineVirtualizationOverscan,
  rows,
  scrollTop,
  threshold = timelineVirtualizationThreshold
}: VirtualTimelineWindowInput): ComputedVirtualTimelineWindow {
  if (rows.length <= threshold) {
    return { enabled: false, endIndex: rows.length, paddingBottom: 0, paddingTop: 0, rows, startIndex: 0 };
  }
  const heights = rows.map(estimateTimelineRowHeight);
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  heights.forEach((height, index) => {
    offsets[index + 1] = (offsets[index] ?? 0) + height;
  });
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const visibleStart = Math.max(0, scrollTop - 360);
  const visibleEnd = Math.min(totalHeight, scrollTop + clientHeight + 360);
  const startIndex = Math.max(0, lowerBound(offsets, visibleStart) - overscan);
  const endIndex = Math.min(rows.length, lowerBound(offsets, visibleEnd) + overscan);
  return {
    enabled: true,
    endIndex,
    paddingBottom: Math.max(0, totalHeight - (offsets[endIndex] ?? totalHeight)),
    paddingTop: offsets[startIndex] ?? 0,
    rows: rows.slice(startIndex, endIndex),
    startIndex
  };
}

function lowerBound(values: number[], target: number): number {
  let left = 0;
  let right = values.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if ((values[middle] ?? 0) < target) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }
  return left;
}

function estimateTimelineRowHeight(row: TimelineRow): number {
  if (row.kind === "date") {
    return 44;
  }
  const message = row.message;
  const bodyLines = Math.max(1, Math.ceil(message.body.length / 54));
  const replyHeight = message.replyToEventId ? 58 : 0;
  const reactionHeight = message.reactions?.length ? 30 : 0;
  const attachmentHeight =
    message.kind === "image" || message.kind === "video"
      ? 236
      : message.kind === "location"
        ? 112
        : message.kind === "file"
          ? 84
          : 0;
  return Math.max(48, 28 + bodyLines * 24 + replyHeight + reactionHeight + attachmentHeight);
}
