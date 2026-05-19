export interface HealthStatus {
  status: string;
  timestamp: string;
}

export interface SourceSystem {
  sourceSystemId: string;
  displayName: string;
  sourceType: string;
  status?: string;
  synthetic: boolean;
}

export interface CopObject {
  objectId: string;
  objectType: string;
  affiliation: string;
  domain: string;
  status: string;
  confidence?: number;
  synthetic?: boolean;
  lastUpdatedAt?: string;
  position?: {
    lat: number;
    lon: number;
    altitudeM?: number | null;
  };
  movement?: {
    speedMps?: number | null;
    headingDeg?: number | null;
    verticalRateMps?: number | null;
  };
  speedMps?: number | null;
  headingDeg?: number | null;
  verticalRateMps?: number | null;
}

export interface ServerTrackHistoryPoint {
  affiliation: string;
  confidence?: number;
  eventId?: string;
  ingestTimestamp?: string;
  lat: number;
  lon: number;
  objectId: string;
  objectType?: string;
  producerTimestamp?: string;
  sourceSystemId?: string;
  status?: string;
  synthetic?: boolean;
  timestamp: string;
}

export interface CopDashboardData {
  health: HealthStatus;
  sources: SourceSystem[];
  objects: CopObject[];
  trackHistory?: Record<string, ServerTrackHistoryPoint[]>;
}

export type CopStreamStatus = "connecting" | "degraded" | "live" | "polling";

export type CopStreamMessage =
  | {
      changes: Array<{ changeType: "OBJECT_SNAPSHOT" | "OBJECT_UPSERT"; object: CopObject }>;
      sequence: number;
      serverTimestamp: string;
      subscriptionId: string;
      type: "snapshot";
    }
  | {
      changes: Array<{ changeType: "OBJECT_UPSERT"; object: CopObject }>;
      sequence: number;
      serverTimestamp: string;
      type: "delta";
    }
  | {
      sequence: number;
      serverTimestamp: string;
      type: "heartbeat";
    };

export interface CopStreamConnection {
  close: () => void;
}

export interface CopStreamHandlers {
  onError: (error: Error) => void;
  onMessage: (message: CopStreamMessage) => void;
  onOpen: () => void;
}

export interface CopHistoryOptions {
  limit: number;
  seconds: number;
}

export interface CopDashboardFilters {
  includeSynthetic: boolean;
  minConfidence: number;
}

export type CopLayer = "air-situation" | "uav" | "friendly" | "foreign" | "data-quality";

export async function fetchCopDashboardData(
  apiBase: string,
  token = "dev-lab-token",
  historyOptions?: CopHistoryOptions
): Promise<CopDashboardData> {
  const headers = { Authorization: `Bearer ${token}` };
  const [health, sources, tracks, history] = await Promise.all([
    fetchJson<HealthStatus>(`${apiBase}/health/ready`),
    fetchJson<{ items?: SourceSystem[] }>(`${apiBase}/api/v1/sources`, { headers }),
    fetchJson<{ items?: CopObject[] }>(`${apiBase}/api/v1/cop/tracks?includeSynthetic=true`, { headers }),
    historyOptions
      ? fetchOptionalJson<{ items?: Array<{ objectId: string; points: ServerTrackHistoryPoint[] }> }>(
          `${apiBase}/api/v1/cop/track-history?seconds=${historyOptions.seconds}&limit=${historyOptions.limit}`,
          { headers }
        )
      : Promise.resolve(undefined)
  ]);

  return {
    health,
    sources: sources.items ?? [],
    objects: tracks.items ?? [],
    trackHistory: history?.items ? Object.fromEntries(history.items.map((item) => [item.objectId, item.points])) : undefined
  };
}

export function connectCopStream(apiBase: string, token: string, handlers: CopStreamHandlers): CopStreamConnection | null {
  if (typeof ReadableStream === "undefined") {
    return null;
  }

  const controller = new AbortController();
  void readCopStream(apiBase, token, controller.signal, handlers)
    .then(() => {
      if (!controller.signal.aborted) {
        handlers.onError(new Error("COP live stream closed."));
      }
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        handlers.onError(error instanceof Error ? error : new Error("COP live stream failed."));
      }
    });

  return {
    close: () => controller.abort()
  };
}

export function filterVisibleObjects(objects: CopObject[], filters: CopDashboardFilters): CopObject[] {
  return objects.filter((object) => {
    if (!filters.includeSynthetic && object.synthetic) {
      return false;
    }
    return (object.confidence ?? 0) >= filters.minConfidence;
  });
}

export function filterObjectsByLayer(objects: CopObject[], layer: CopLayer): CopObject[] {
  if (layer === "uav") {
    return objects.filter((object) => object.objectType === "UAV");
  }
  if (layer === "friendly") {
    return objects.filter((object) => object.affiliation === "FRIEND" || object.affiliation === "ASSUMED_FRIEND");
  }
  if (layer === "foreign") {
    return objects.filter((object) => object.affiliation === "HOSTILE" || object.affiliation === "SUSPECT");
  }
  if (layer === "data-quality") {
    return objects.filter((object) => (object.confidence ?? 0) < 0.5);
  }
  return objects;
}

export function getDataQualityCount(objects: CopObject[]): number {
  return objects.filter((object) => (object.confidence ?? 0) < 0.5).length;
}

export function getUavCount(objects: CopObject[]): number {
  return objects.filter((object) => object.objectType === "UAV").length;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "API request failed"} for ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchOptionalJson<T>(url: string, init?: RequestInit): Promise<T | undefined> {
  try {
    return await fetchJson<T>(url, init);
  } catch {
    return undefined;
  }
}

async function readCopStream(apiBase: string, token: string, signal: AbortSignal, handlers: CopStreamHandlers): Promise<void> {
  const response = await fetch(joinApiPath(apiBase, "/api/v1/stream/cop/live"), {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`
    },
    signal
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || "COP stream failed"}`);
  }
  if (!response.body) {
    throw new Error("Browser does not expose a readable COP stream.");
  }

  handlers.onOpen();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/u);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = readSseData(block);
      if (!data) {
        continue;
      }
      handlers.onMessage(JSON.parse(data) as CopStreamMessage);
    }
  }
}

function readSseData(block: string): string | null {
  const dataLines = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function joinApiPath(base: string, path: string): string {
  if (!base) {
    return path;
  }
  return `${base.replace(/\/$/u, "")}${path}`;
}
