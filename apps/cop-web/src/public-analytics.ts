/** Exact public synthetic-demo pageviews and normalized entry source; no application/context data. */
import { authSessionStorageKey } from "./auth";
export const publicAnalyticsPaths = ["/demo/flood-central-bohemia"] as const;
export const analyticsRuntimePath = "/analytics/v2/tracker.js";
export const analyticsCollectorPath = "/analytics/v2/events";

type Client = { pageview(path: string): void };
type Runtime = {
  contractVersion: "vcode-public-v2";
  create(config: {
    websiteId: string;
    collectorPath: string;
    allowedPaths: readonly string[];
    allowedEvents: [];
    autoPageview: false;
    autoClick: false;
    captureTitle: false;
    captureReferrer: false;
    captureSources: true;
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
  anonymous(): Promise<boolean>;
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
    const requestGeneration = ++generation;
    try {
      if (
        !(await environment.anonymous()) ||
        generation !== requestGeneration ||
        environment.pathname() !== path ||
        !environment.permitted()
      )
        return;
      previous = path;
      loading ??= environment.load();
      const runtime = await loading;
      if (
        generation !== requestGeneration ||
        environment.pathname() !== path ||
        !environment.permitted() ||
        runtime?.contractVersion !== "vcode-public-v2" ||
        typeof runtime?.create !== "function" ||
        !(await environment.anonymous()) ||
        generation !== requestGeneration ||
        environment.pathname() !== path ||
        environment.hostname() !== "cop.zeleznalady.cz" ||
        !environment.permitted()
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
        captureSources: true,
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
      anonymous: async () =>
        permitsAnonymousPublicAnalytics(
          {
            storedSession: hasStoredAnalyticsSession(),
            bffEnabled: import.meta.env.VITE_COP_BFF_SESSION_ENABLED === "true"
          },
          async () => {
            const response = await fetch("/api/v1/auth/session", {
              credentials: "same-origin",
              redirect: "error",
              cache: "no-store"
            });
            if (response.status === 401) return { status: 401 };
            const body: unknown = await response.json();
            return {
              status: response.status,
              authenticated:
                typeof body === "object" && body !== null && "authenticated" in body ? body.authenticated : undefined
            };
          }
        ),
      load: () =>
        new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = analyticsRuntimePath;
          script.async = true;
          script.integrity = "sha384-4mn0sN5UeFuzSjaXlbulwbJz7N38PPOovouC9Xp3OHD0r94YKgx8B2RAk/nK6mg0";
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

/** Read only session presence, never tokens or identity; unknown storage blocks collection. */
function hasStoredAnalyticsSession(): boolean {
  try {
    return Boolean(
      window.localStorage.getItem(authSessionStorageKey) || window.sessionStorage.getItem(authSessionStorageKey)
    );
  } catch {
    return true;
  }
}

export async function permitsAnonymousPublicAnalytics(
  settings: { storedSession: boolean; bffEnabled: boolean },
  checkSession: () => Promise<{ status: number; authenticated?: unknown }>
): Promise<boolean> {
  if (settings.storedSession) return false;
  if (!settings.bffEnabled) return true;
  try {
    const session = await checkSession();
    return session.status === 401 || (session.status === 200 && session.authenticated === false);
  } catch {
    return false;
  }
}
