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
}

export interface CopDashboardData {
  health: HealthStatus;
  sources: SourceSystem[];
  objects: CopObject[];
}

export interface CopDashboardFilters {
  includeSynthetic: boolean;
  minConfidence: number;
}

export type CopLayer = "air-situation" | "uav" | "data-quality";

export async function fetchCopDashboardData(apiBase: string, token = "dev-lab-token"): Promise<CopDashboardData> {
  const headers = { Authorization: `Bearer ${token}` };
  const [health, sources, tracks] = await Promise.all([
    fetchJson<HealthStatus>(`${apiBase}/health/ready`),
    fetchJson<{ items?: SourceSystem[] }>(`${apiBase}/api/v1/sources`, { headers }),
    fetchJson<{ items?: CopObject[] }>(`${apiBase}/api/v1/cop/tracks?includeSynthetic=true`, { headers })
  ]);

  return {
    health,
    sources: sources.items ?? [],
    objects: tracks.items ?? []
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
