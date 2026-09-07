export type CopWebMetricName = "CLS" | "INP" | "LCP" | "LONG_TASK" | "NAVIGATION";
export type CopWebMetricRating = "good" | "needs-improvement" | "poor";

export interface CopWebPerformanceMetric {
  at: string;
  name: CopWebMetricName;
  rating: CopWebMetricRating;
  value: number;
}

declare global {
  interface Window {
    __COP_WEB_PERFORMANCE__?: CopWebPerformanceMetric[];
    __copWebPerformanceMonitoringStarted?: boolean;
  }

  interface WindowEventMap {
    "cop:web-performance": CustomEvent<CopWebPerformanceMetric>;
  }
}

export function rateWebMetric(name: CopWebMetricName, value: number): CopWebMetricRating {
  const thresholds: Record<CopWebMetricName, [number, number]> = {
    CLS: [0.1, 0.25],
    INP: [200, 500],
    LCP: [2500, 4000],
    LONG_TASK: [100, 250],
    NAVIGATION: [2500, 4000]
  };
  const [good, poor] = thresholds[name];
  if (value <= good) {
    return "good";
  }
  return value <= poor ? "needs-improvement" : "poor";
}

export function startWebPerformanceMonitoring(): () => void {
  if (typeof window === "undefined" || window.__copWebPerformanceMonitoringStarted) {
    return () => undefined;
  }
  window.__copWebPerformanceMonitoringStarted = true;
  window.__COP_WEB_PERFORMANCE__ ??= [];
  const observers: PerformanceObserver[] = [];
  let cumulativeLayoutShift = 0;
  let largestInteraction = 0;

  const emit = (name: CopWebMetricName, value: number) => {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    const metric: CopWebPerformanceMetric = {
      at: new Date().toISOString(),
      name,
      rating: rateWebMetric(name, value),
      value: Math.round(value * 1000) / 1000
    };
    const store = window.__COP_WEB_PERFORMANCE__ ?? [];
    store.push(metric);
    if (store.length > 100) {
      store.splice(0, store.length - 100);
    }
    window.__COP_WEB_PERFORMANCE__ = store;
    window.dispatchEvent(new CustomEvent("cop:web-performance", { detail: metric }));
  };

  const observe = (type: string, handler: (entries: PerformanceEntry[]) => void, durationThreshold?: number) => {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes(type)) {
      return;
    }
    try {
      const observer = new PerformanceObserver((list) => handler(list.getEntries()));
      const options: PerformanceObserverInit = { buffered: true, type };
      if (typeof durationThreshold === "number") {
        Object.assign(options, { durationThreshold });
      }
      observer.observe(options);
      observers.push(observer);
    } catch {
      // Older WebKit versions can expose an entry type without accepting all
      // observer options. Performance telemetry must never block the app.
    }
  };

  observe("largest-contentful-paint", (entries) => {
    const latest = entries.at(-1);
    if (latest) {
      emit("LCP", latest.startTime);
    }
  });

  observe("layout-shift", (entries) => {
    entries.forEach((entry) => {
      const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
      if (!shift.hadRecentInput && typeof shift.value === "number") {
        cumulativeLayoutShift += shift.value;
      }
    });
    emit("CLS", cumulativeLayoutShift);
  });

  observe(
    "event",
    (entries) => {
      entries.forEach((entry) => {
        largestInteraction = Math.max(largestInteraction, entry.duration);
      });
      emit("INP", largestInteraction);
    },
    40
  );

  observe("longtask", (entries) => entries.forEach((entry) => emit("LONG_TASK", entry.duration)));

  const emitNavigation = () => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      emit("NAVIGATION", navigation.loadEventEnd || navigation.domContentLoadedEventEnd || navigation.duration);
    }
  };
  if (document.readyState === "complete") {
    emitNavigation();
  } else {
    window.addEventListener("load", emitNavigation, { once: true });
  }

  return () => {
    observers.forEach((observer) => observer.disconnect());
    window.removeEventListener("load", emitNavigation);
    window.__copWebPerformanceMonitoringStarted = false;
  };
}
