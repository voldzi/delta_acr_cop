/** Public synthetic-demo pageviews only; no application/context data. */
export const publicAnalyticsPaths = ["/demo/flood-central-bohemia"] as const;
export const analyticsRuntimePath = "/analytics/v1/tracker.js";
export const analyticsCollectorPath = "/analytics/v1/events";

type Client = { pageview(path: string): void };
type Runtime = {
  contractVersion: "vcode-public-v1";
  create(config: {
    websiteId: string;
    collectorPath: string;
    allowedPaths: readonly string[];
    allowedEvents: [];
    autoPageview: false;
    autoClick: false;
    captureTitle: false;
    captureReferrer: false;
    credentials: "omit";
    offline: "discard";
  }): Client;
};
export function permitsPublicAnalytics(settings: {
  online: boolean;
  dnt: string | null;
  windowDnt?: string;
  gpc?: boolean;
}): boolean {
  return settings.online && settings.dnt !== "1" && settings.windowDnt !== "1" && settings.gpc !== true;
}

export type PublicAnalyticsEnvironment = {
  hostname(): string;
  pathname(): string;
  permitted(): boolean;
  load(): Promise<Runtime | undefined>;
};

export function createPublicAnalyticsBridge(
  config: { enabled: boolean; websiteId: string },
  environment: PublicAnalyticsEnvironment
) {
  let previous: string | null = null;
  let generation = 0;
  let loading: Promise<Runtime | undefined> | undefined;
  let client: Client | undefined;
  return async function observe(): Promise<void> {
    const path = environment.pathname();
    if (
      !config.enabled ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(config.websiteId) ||
      environment.hostname() !== "cop.zeleznalady.cz" ||
      !publicAnalyticsPaths.some((allowed) => allowed === path) ||
      !environment.permitted()
    ) {
      previous = null;
      generation += 1;
      return;
    }
    if (previous === path) return;
    previous = path;
    const requestGeneration = ++generation;
    try {
      loading ??= environment.load();
      const runtime = await loading;
      if (
        generation !== requestGeneration ||
        environment.pathname() !== path ||
        !environment.permitted() ||
        runtime?.contractVersion !== "vcode-public-v1" ||
        typeof runtime?.create !== "function"
      )
        return;
      client ??= runtime.create({
        websiteId: config.websiteId,
        collectorPath: analyticsCollectorPath,
        allowedPaths: publicAnalyticsPaths,
        allowedEvents: [],
        autoPageview: false,
        autoClick: false,
        captureTitle: false,
        captureReferrer: false,
        credentials: "omit",
        offline: "discard"
      });
      client.pageview(path);
    } catch {
      // Analytics failure must not affect the crisis application. Never queue/retry.
    }
  };
}

let observe: (() => Promise<void>) | undefined;
export function observePublicDemoPageview(): void {
  observe ??= createPublicAnalyticsBridge(
    {
      enabled: import.meta.env.VITE_COP_PUBLIC_ANALYTICS_ENABLED === "true",
      websiteId: String(import.meta.env.VITE_COP_PUBLIC_ANALYTICS_WEBSITE_ID ?? "")
    },
    {
      hostname: () => window.location.hostname,
      pathname: () => window.location.pathname,
      permitted: () =>
        permitsPublicAnalytics({
          online: navigator.onLine !== false,
          dnt: navigator.doNotTrack,
          windowDnt: (window as Window & { doNotTrack?: string }).doNotTrack,
          gpc: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
        }),
      load: () =>
        new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = analyticsRuntimePath;
          script.async = true;
          script.integrity = "sha384-lhej7Cxih2xEDtoPqh2B7mI4JilbkjF9HtVj+agiDEv8P6XAO98U6FJUCNpIVsMN";
          script.crossOrigin = "anonymous";
          script.referrerPolicy = "no-referrer";
          script.onload = () => resolve((window as Window & { vcodePublicAnalytics?: Runtime }).vcodePublicAnalytics);
          script.onerror = () => resolve(undefined);
          document.head.appendChild(script);
        })
    }
  );
  void observe();
}
