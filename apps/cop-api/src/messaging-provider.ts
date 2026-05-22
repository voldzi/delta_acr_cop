export type MessagingIntegrationRuntimeStatus = "degraded" | "disabled" | "online";

export interface MessagingProviderConfig {
  baseUrl: string;
  cacheTtlMs: number;
  enabled: boolean;
  publicUrl?: string;
  timeoutMs: number;
  token?: string;
}

export interface MessagingProviderStatus {
  architecture?: Record<string, unknown>;
  chatAvailable: boolean;
  checkedAt: string;
  contractVersion: "cop-messaging-status-v1";
  detail?: string;
  enabled: boolean;
  features?: Record<string, unknown>;
  providerId: "csm.messaging";
  publicUrl?: string;
  security?: Record<string, unknown>;
  serviceName: string;
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingProvider {
  readonly config: MessagingProviderConfig;
  fetchStatus(requestNow: Date): Promise<MessagingProviderStatus>;
}

interface CsmMessagingCapabilities {
  architecture?: Record<string, unknown>;
  contractVersion?: string;
  features?: Record<string, unknown>;
  providerId?: string;
  security?: Record<string, unknown>;
  serviceName?: string;
  status?: string;
}

interface CsmMessagingHealth {
  checks?: Array<{ id?: string; message?: string; status?: string }>;
  status?: string;
}

const defaultConfig: MessagingProviderConfig = {
  baseUrl: "http://docker.home.cz:4050",
  cacheTtlMs: 10_000,
  enabled: false,
  timeoutMs: 3_000
};

export function createMessagingProviderFromEnv(env: Record<string, string | undefined> = process.env): MessagingProvider {
  return new CsmMessagingProvider({
    baseUrl: trimTrailingSlash(env.COP_CSM_MESSAGING_BASE_URL ?? defaultConfig.baseUrl),
    cacheTtlMs: readInteger(env.COP_CSM_MESSAGING_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 300000),
    enabled: readBoolean(env.COP_CSM_MESSAGING_ENABLED, defaultConfig.enabled),
    ...(optionalTrimmedString(env.COP_CSM_MESSAGING_PUBLIC_URL) ? { publicUrl: optionalTrimmedString(env.COP_CSM_MESSAGING_PUBLIC_URL) } : {}),
    timeoutMs: readInteger(env.COP_CSM_MESSAGING_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000),
    ...(optionalTrimmedString(env.COP_CSM_MESSAGING_TOKEN) ? { token: optionalTrimmedString(env.COP_CSM_MESSAGING_TOKEN) } : {})
  });
}

export class CsmMessagingProvider implements MessagingProvider {
  private cachedStatus: { expiresAtMs: number; value: MessagingProviderStatus } | null = null;
  private inflightStatus: Promise<MessagingProviderStatus> | null = null;

  constructor(readonly config: MessagingProviderConfig) {}

  async fetchStatus(requestNow: Date): Promise<MessagingProviderStatus> {
    if (!this.config.enabled) {
      return disabledMessagingStatus(requestNow, this.config);
    }
    if (this.cachedStatus && this.cachedStatus.expiresAtMs > requestNow.getTime()) {
      return this.cachedStatus.value;
    }
    if (!this.inflightStatus) {
      this.inflightStatus = this.fetchFreshStatus(requestNow)
        .finally(() => {
          this.inflightStatus = null;
        });
    }
    const status = await this.inflightStatus;
    this.cachedStatus = {
      expiresAtMs: requestNow.getTime() + this.config.cacheTtlMs,
      value: status
    };
    return status;
  }

  private async fetchFreshStatus(requestNow: Date): Promise<MessagingProviderStatus> {
    try {
      const [capabilitiesResult, healthResult] = await Promise.all([
        fetchJsonWithStatus(new URL(`${this.config.baseUrl}/api/v1/capabilities`), this.config, requestNow),
        fetchJsonWithStatus(new URL(`${this.config.baseUrl}/health/ready`), this.config, requestNow)
      ]);
      if (!isRecord(capabilitiesResult.body)) {
        return degradedMessagingStatus(requestNow, this.config, "Messaging capabilities response is not valid JSON.");
      }

      const capabilities = normalizeCapabilities(capabilitiesResult.body);
      const health = isRecord(healthResult.body) ? normalizeHealth(healthResult.body) : undefined;
      const warnings = [
        ...(capabilities.contractVersion === "csm-messaging-provider-v1" ? [] : [`Messaging contract version is ${capabilities.contractVersion ?? "unknown"}.`]),
        ...(capabilities.providerId === "csm.messaging" ? [] : [`Messaging provider id is ${capabilities.providerId ?? "unknown"}.`]),
        ...statusWarnings(capabilities.status, "capabilities"),
        ...statusWarnings(health?.status, "health"),
        ...healthCheckWarnings(health),
        ...(capabilities.security?.readFromBrowser === true ? ["Messaging provider unexpectedly allows direct browser reads. COP will still use server-side integration only."] : []),
        ...(capabilities.architecture?.plaintextOnServer === true ? ["Messaging provider reports plaintext server handling; chat UI remains disabled."] : []),
        "Messaging metadata API is available server-side. End-to-end chat remains disabled until client-safe Matrix token bootstrap is ready."
      ];
      const providerOk = capabilitiesResult.ok && isOperationalStatus(capabilities.status);
      const healthOk = healthResult.ok && isOperationalStatus(health?.status);
      const status: MessagingIntegrationRuntimeStatus = providerOk && healthOk ? "online" : "degraded";

      return {
        architecture: capabilities.architecture,
        chatAvailable: false,
        checkedAt: requestNow.toISOString(),
        contractVersion: "cop-messaging-status-v1",
        detail: health?.status ? `provider=${capabilities.status ?? "unknown"}; health=${health.status}` : `provider=${capabilities.status ?? "unknown"}`,
        enabled: true,
        features: capabilities.features,
        providerId: "csm.messaging",
        ...(this.config.publicUrl ? { publicUrl: this.config.publicUrl } : {}),
        security: capabilities.security,
        serviceName: capabilities.serviceName ?? "CSM Messaging",
        status,
        warnings: Array.from(new Set(warnings))
      };
    } catch (error) {
      return degradedMessagingStatus(requestNow, this.config, errorMessage(error));
    }
  }
}

export function disabledMessagingStatus(requestNow: Date, config: MessagingProviderConfig = defaultConfig): MessagingProviderStatus {
  return {
    chatAvailable: false,
    checkedAt: requestNow.toISOString(),
    contractVersion: "cop-messaging-status-v1",
    detail: "Messaging provider integration is disabled by COP_CSM_MESSAGING_ENABLED.",
    enabled: false,
    providerId: "csm.messaging",
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
    serviceName: "CSM Messaging",
    status: "disabled",
    warnings: ["Messaging is configured as an experimental provider and is currently disabled."]
  };
}

function degradedMessagingStatus(requestNow: Date, config: MessagingProviderConfig, detail: string): MessagingProviderStatus {
  return {
    chatAvailable: false,
    checkedAt: requestNow.toISOString(),
    contractVersion: "cop-messaging-status-v1",
    detail,
    enabled: config.enabled,
    providerId: "csm.messaging",
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
    serviceName: "CSM Messaging",
    status: "degraded",
    warnings: [detail, "Chat messages are disabled until the Matrix-backed messaging contract is available."]
  };
}

async function fetchJsonWithStatus(url: URL, config: MessagingProviderConfig, requestNow: Date): Promise<{ body: unknown; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-COP-Request-At": requestNow.toISOString()
    };
    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    return {
      body: text ? JSON.parse(text) as unknown : {},
      ok: response.ok,
      status: response.status
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCapabilities(value: Record<string, unknown>): CsmMessagingCapabilities {
  return {
    architecture: isRecord(value.architecture) ? value.architecture : undefined,
    contractVersion: optionalString(value.contractVersion),
    features: isRecord(value.features) ? value.features : undefined,
    providerId: optionalString(value.providerId),
    security: isRecord(value.security) ? value.security : undefined,
    serviceName: optionalString(value.serviceName),
    status: optionalString(value.status)
  };
}

function normalizeHealth(value: Record<string, unknown>): CsmMessagingHealth {
  return {
    checks: Array.isArray(value.checks)
      ? value.checks.flatMap((check): Array<{ id?: string; message?: string; status?: string }> => isRecord(check)
        ? [{
            id: optionalString(check.id),
            message: optionalString(check.message),
            status: optionalString(check.status)
          }]
        : [])
      : undefined,
    status: optionalString(value.status)
  };
}

function healthCheckWarnings(health: CsmMessagingHealth | undefined): string[] {
  return (health?.checks ?? []).flatMap((check) =>
    isOperationalStatus(check.status) ? [] : [`${check.id ?? "check"}: ${check.message ?? check.status ?? "degraded"}`]
  );
}

function statusWarnings(status: string | undefined, label: string): string[] {
  return isOperationalStatus(status) ? [] : [`Messaging ${label} status is ${status ?? "unknown"}.`];
}

function isOperationalStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase();
  return normalized === "ok" || normalized === "online" || normalized === "ready";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

function readInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
