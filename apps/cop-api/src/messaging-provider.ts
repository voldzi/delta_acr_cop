import type { AuthenticatedActor } from "./security.js";

export type MessagingIntegrationRuntimeStatus = "degraded" | "disabled" | "online";

export interface MessagingProviderConfig {
  baseUrl: string;
  cacheTtlMs: number;
  enabled: boolean;
  matrixHomeserverPublicUrl?: string;
  publicUrl?: string;
  timeoutMs: number;
  token?: string;
  webPushEnabled?: boolean;
  webPushVapidPublicKey?: string;
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

export interface MessagingMatrixBootstrap {
  accessToken?: string;
  chatAvailable: boolean;
  contractVersion: "cop-messaging-bootstrap-v1";
  detail?: string;
  deviceId?: string;
  e2eeRequired?: boolean;
  enabled: boolean;
  expiresAt?: string;
  homeserverBaseUrl?: string;
  providerId: "csm.messaging";
  serverName?: string;
  status: MessagingIntegrationRuntimeStatus;
  tokenAvailable: boolean;
  userId?: string;
  warnings: string[];
}

export interface MessagingConversationMember {
  avatarUrl?: string;
  displayName?: string;
  role?: string;
  userId: string;
}

export interface MessagingMapLink {
  bbox?: number[];
  label?: string;
  layerId?: string;
  targetId: string;
}

export interface MessagingConversationSummary {
  avatarDataUrl?: string;
  avatarUrl?: string;
  canonicalKey?: string;
  conversationId: string;
  conversationKind: "direct" | "group" | "personal_ai";
  createdAt?: string;
  disclaimer?: string;
  directPeer?: {
    avatarUrl?: string;
    displayName?: string;
    userId: string;
  };
  e2eeRequired?: boolean;
  encrypted?: boolean;
  mapLinkCount?: number;
  matrix?: {
    homeserverBaseUrl?: string;
    roomId?: string | null;
    serverName?: string;
    state?: string;
  };
  memberCount?: number;
  members?: MessagingConversationMember[];
  metadata?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
  status?: string;
  title: string;
  type: "direct" | "group";
  updatedAt?: string;
}

export interface MessagingConversationList {
  contractVersion: "cop-messaging-conversations-v1";
  conversations: MessagingConversationSummary[];
  count: number;
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingConversationCreateRequest {
  avatarUrl?: string;
  conversationKind: "direct" | "group" | "personal_ai";
  mapLinks?: MessagingMapLink[];
  members?: MessagingConversationMember[];
  metadata?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
  title: string;
  type?: "direct" | "group";
}

export interface MessagingConversationCreateResponse {
  contractVersion: "cop-messaging-conversations-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingConversationDetailResponse {
  contractVersion: "cop-messaging-conversations-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingMatrixIdentity {
  avatarUrl?: string;
  displayName?: string;
  matrixUserId: string;
  userId: string;
}

export interface MessagingMatrixIdentityResolution {
  contractVersion: "cop-messaging-identities-v1";
  enabled: boolean;
  identities: MessagingMatrixIdentity[];
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingMatrixRoomBindingRequest {
  encrypted?: boolean;
  roomId?: string;
}

export interface MessagingMatrixRoomBindingResponse {
  contractVersion: "cop-messaging-room-binding-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingNotificationAudience {
  areaIds?: string[];
  groupIds?: string[];
  userIds?: string[];
}

export interface MessagingLocalizedText {
  cs: string;
  en?: string;
}

export interface MessagingNotificationIntakeRequest {
  audience: MessagingNotificationAudience;
  body: MessagingLocalizedText;
  deepLink: string;
  expiresAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
  priority?: string;
  severity: string;
  source: {
    featureId: string;
    layerId: string;
    providerId: string;
    sourceName?: string;
  };
  title: MessagingLocalizedText;
  type: string;
}

export interface MessagingNotificationIntakeResponse {
  contractVersion: "cop-messaging-notification-v1";
  deduplicated?: boolean;
  enabled: boolean;
  notificationId?: string;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MatrixPushGatewayResponse {
  rejected: string[];
}

export interface MessagingMatrixPushGatewayForwardResponse {
  body: MatrixPushGatewayResponse;
  ok: boolean;
  status: MessagingIntegrationRuntimeStatus;
  statusCode: number;
  warnings: string[];
}

export interface MessagingConversationMemberSyncResponse {
  contractVersion: "cop-messaging-conversations-v1";
  conversation?: MessagingConversationSummary;
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingWebPushConfigResponse {
  contractVersion: "cop-web-push-config-v1";
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  vapidPublicKey?: string;
  warnings: string[];
}

export interface MessagingWebPushDeviceRegistrationRequest {
  capabilities?: string[];
  deviceId: string;
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  locale?: string;
  notificationPreferences?: Record<string, boolean>;
  timezone?: string;
}

export interface MessagingWebPushDeviceRegistrationResponse {
  contractVersion: "cop-web-push-device-v1";
  deviceId?: string;
  enabled: boolean;
  providerId: "csm.messaging";
  registered: boolean;
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingWebPushDeviceDeletionResponse {
  contractVersion: "cop-web-push-device-v1";
  deleted: boolean;
  deviceId?: string;
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingCrossSigningPublicKey {
  keys: Record<string, string>;
  signatures?: Record<string, Record<string, string>>;
  usage: ["master" | "self_signing" | "user_signing"];
  user_id: string;
}

export interface MessagingE2eeResetAuthRequest {
  deviceId: string;
  masterKey: MessagingCrossSigningPublicKey;
  selfSigningKey: MessagingCrossSigningPublicKey;
  userSigningKey: MessagingCrossSigningPublicKey;
}

export interface MessagingE2eeResetAuthResponse {
  completed: boolean;
  contractVersion: "cop-messaging-e2ee-reset-auth-v1";
  enabled: boolean;
  providerId: "csm.messaging";
  status: MessagingIntegrationRuntimeStatus;
  warnings: string[];
}

export interface MessagingProvider {
  readonly config: MessagingProviderConfig;
  fetchStatus(requestNow: Date): Promise<MessagingProviderStatus>;
  fetchWebPushConfig(requestNow: Date): Promise<MessagingWebPushConfigResponse>;
  fetchMatrixBootstrap(
    actor: AuthenticatedActor,
    requestNow: Date,
    deviceId?: string
  ): Promise<MessagingMatrixBootstrap>;
  completeE2eeResetAuth(
    actor: AuthenticatedActor,
    requestNow: Date,
    input: MessagingE2eeResetAuthRequest
  ): Promise<MessagingE2eeResetAuthResponse>;
  fetchConversations(actor: AuthenticatedActor, requestNow: Date): Promise<MessagingConversationList>;
  fetchConversation(
    actor: AuthenticatedActor,
    requestNow: Date,
    conversationId: string
  ): Promise<MessagingConversationDetailResponse>;
  fetchConversationByRoomId(
    actor: AuthenticatedActor,
    requestNow: Date,
    roomId: string
  ): Promise<MessagingConversationDetailResponse>;
  createConversation(
    actor: AuthenticatedActor,
    requestNow: Date,
    input: MessagingConversationCreateRequest
  ): Promise<MessagingConversationCreateResponse>;
  addConversationMembers(
    actor: AuthenticatedActor,
    requestNow: Date,
    conversationId: string,
    members: MessagingConversationMember[]
  ): Promise<MessagingConversationMemberSyncResponse>;
  bindMatrixRoom(
    actor: AuthenticatedActor,
    requestNow: Date,
    conversationId: string,
    input: MessagingMatrixRoomBindingRequest
  ): Promise<MessagingMatrixRoomBindingResponse>;
  resolveMatrixIdentities(
    actor: AuthenticatedActor,
    requestNow: Date,
    userIds: string[]
  ): Promise<MessagingMatrixIdentityResolution>;
  registerWebPushDevice(
    actor: AuthenticatedActor,
    requestNow: Date,
    input: MessagingWebPushDeviceRegistrationRequest
  ): Promise<MessagingWebPushDeviceRegistrationResponse>;
  deleteWebPushDevice(
    actor: AuthenticatedActor,
    requestNow: Date,
    deviceId: string
  ): Promise<MessagingWebPushDeviceDeletionResponse>;
  sendNotification(
    actor: AuthenticatedActor | undefined,
    requestNow: Date,
    idempotencyKey: string,
    input: MessagingNotificationIntakeRequest
  ): Promise<MessagingNotificationIntakeResponse>;
  forwardMatrixPushNotification(requestNow: Date, input: unknown): Promise<MessagingMatrixPushGatewayForwardResponse>;
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

interface CsmMessagingMatrixTokenResponse {
  accessToken?: string;
  contractVersion?: string;
  deviceId?: string;
  e2eeRequired?: boolean;
  expiresAt?: string;
  homeserverBaseUrl?: string;
  providerId?: string;
  serverName?: string;
  status?: string;
  tokenAvailable?: boolean;
  userId?: string;
  warnings?: string[];
}

interface CsmMessagingE2eeResetAuthProviderResponse {
  completed?: boolean;
  contractVersion?: string;
  providerId?: string;
  status?: string;
  warnings?: string[];
}

interface CsmMessagingConversationListResponse {
  conversations?: unknown[];
  count?: number;
  contractVersion?: string;
  providerId?: string;
}

interface CsmMessagingConversationCreateProviderResponse {
  contractVersion?: string;
  conversation?: unknown;
  providerId?: string;
}

interface CsmMessagingIdentityResolutionProviderResponse {
  contractVersion?: string;
  identities?: unknown[];
  items?: unknown[];
  providerId?: string;
}

interface CsmMessagingRoomBindingProviderResponse {
  contractVersion?: string;
  conversation?: unknown;
  providerId?: string;
}

interface CsmMessagingNotificationProviderResponse {
  contractVersion?: string;
  deduplicated?: boolean;
  notificationId?: string;
  providerId?: string;
  status?: string;
  warnings?: string[];
}

interface CsmMessagingWebPushDeviceProviderResponse {
  contractVersion?: string;
  deviceId?: string;
  providerId?: string;
  registered?: boolean;
  status?: string;
  warnings?: string[];
}

const defaultConfig: MessagingProviderConfig = {
  baseUrl: "http://comm.home.cz:4050",
  cacheTtlMs: 10_000,
  enabled: false,
  // Provisioning an encrypted Matrix room includes server-side identity and
  // encryption setup.  It routinely takes longer than a lightweight health
  // request, especially for the first conversation after a deployment.  The
  // previous three-second budget could abort COP while Messaging completed the
  // canonical conversation moments later, leaving clients with a false error.
  timeoutMs: 15_000
};

export function createMessagingProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): MessagingProvider {
  const matrixHomeserverPublicUrl =
    optionalTrimmedString(env.COP_CSM_MESSAGING_MATRIX_PUBLIC_URL) ??
    optionalTrimmedString(env.COP_CSM_MESSAGING_PUBLIC_URL);
  const webPushVapidPublicKey = optionalTrimmedString(env.COP_WEB_PUSH_VAPID_PUBLIC_KEY);
  return new CsmMessagingProvider({
    baseUrl: trimTrailingSlash(env.COP_CSM_MESSAGING_BASE_URL ?? defaultConfig.baseUrl),
    cacheTtlMs: readInteger(env.COP_CSM_MESSAGING_CACHE_TTL_MS, defaultConfig.cacheTtlMs, 1000, 300000),
    enabled: readBoolean(env.COP_CSM_MESSAGING_ENABLED, defaultConfig.enabled),
    ...(matrixHomeserverPublicUrl ? { matrixHomeserverPublicUrl } : {}),
    ...(optionalTrimmedString(env.COP_CSM_MESSAGING_PUBLIC_URL)
      ? { publicUrl: optionalTrimmedString(env.COP_CSM_MESSAGING_PUBLIC_URL) }
      : {}),
    timeoutMs: readInteger(env.COP_CSM_MESSAGING_TIMEOUT_MS, defaultConfig.timeoutMs, 1000, 60000),
    ...(optionalTrimmedString(env.COP_CSM_MESSAGING_TOKEN)
      ? { token: optionalTrimmedString(env.COP_CSM_MESSAGING_TOKEN) }
      : {}),
    webPushEnabled: readBoolean(env.COP_WEB_PUSH_ENABLED, false),
    ...(webPushVapidPublicKey ? { webPushVapidPublicKey } : {})
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
      this.inflightStatus = this.fetchFreshStatus(requestNow).finally(() => {
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

  async fetchWebPushConfig(_requestNow: Date): Promise<MessagingWebPushConfigResponse> {
    if (!this.config.enabled) {
      return disabledWebPushConfig("Messaging provider integration is disabled.");
    }
    if (!this.config.webPushEnabled) {
      return disabledWebPushConfig("Browser notifications are not enabled on this COP deployment.");
    }
    if (!this.config.webPushVapidPublicKey) {
      return degradedWebPushConfig("Browser notification public key is not configured.");
    }
    return {
      contractVersion: "cop-web-push-config-v1",
      enabled: true,
      providerId: "csm.messaging",
      status: "online",
      vapidPublicKey: this.config.webPushVapidPublicKey,
      warnings: []
    };
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
        ...(capabilities.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging contract version is ${capabilities.contractVersion ?? "unknown"}.`]),
        ...(capabilities.providerId === "csm.messaging"
          ? []
          : [`Messaging provider id is ${capabilities.providerId ?? "unknown"}.`]),
        ...statusWarnings(capabilities.status, "capabilities"),
        ...statusWarnings(health?.status, "health"),
        ...healthCheckWarnings(health),
        ...(capabilities.security?.readFromBrowser === true
          ? [
              "Messaging provider unexpectedly allows direct browser reads. COP will still use server-side integration only."
            ]
          : []),
        ...(capabilities.architecture?.plaintextOnServer === true
          ? ["Messaging provider reports plaintext server handling; chat UI remains disabled."]
          : [])
      ];
      const providerOk = capabilitiesResult.ok && isOperationalStatus(capabilities.status);
      const healthOk = healthResult.ok && isOperationalStatus(health?.status);
      const criticalHealthOk = hasClientSafeMessagingHealth(health);
      const status: MessagingIntegrationRuntimeStatus = providerOk && healthOk ? "online" : "degraded";
      let chatAvailable = isClientSafeMatrixBootstrapReady(capabilities, providerOk, criticalHealthOk);
      if (chatAvailable) {
        const publicHomeserverHealth = await checkPublicMatrixHomeserver(this.config);
        if (!publicHomeserverHealth.ok) {
          chatAvailable = false;
          warnings.push(publicHomeserverHealth.detail);
        }
      }
      if (!chatAvailable) {
        warnings.push(
          "Messaging metadata API is available server-side, but client-safe Matrix/E2EE bootstrap is not ready."
        );
      }

      return {
        architecture: capabilities.architecture,
        chatAvailable,
        checkedAt: requestNow.toISOString(),
        contractVersion: "cop-messaging-status-v1",
        detail: health?.status
          ? `provider=${capabilities.status ?? "unknown"}; health=${health.status}`
          : `provider=${capabilities.status ?? "unknown"}`,
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

  async fetchMatrixBootstrap(
    actor: AuthenticatedActor,
    requestNow: Date,
    deviceId?: string
  ): Promise<MessagingMatrixBootstrap> {
    if (!this.config.enabled) {
      return disabledMatrixBootstrap(requestNow, this.config);
    }
    try {
      const tokenResult = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/matrix/token`),
        this.config,
        requestNow,
        {
          ...(deviceId ? { body: JSON.stringify({ deviceId }) } : {}),
          headers: {
            ...actorHeaders(actor, deviceId),
            ...(deviceId ? { "Content-Type": "application/json" } : {})
          },
          method: "POST"
        }
      );
      if (!isRecord(tokenResult.body)) {
        return degradedMatrixBootstrap(requestNow, this.config, "Messaging Matrix token response is not valid JSON.");
      }
      const tokenResponse = normalizeMatrixTokenResponse(tokenResult.body);
      const warnings = [
        ...(tokenResponse.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging token contract version is ${tokenResponse.contractVersion ?? "unknown"}.`]),
        ...(tokenResponse.providerId === "csm.messaging"
          ? []
          : [`Messaging token provider id is ${tokenResponse.providerId ?? "unknown"}.`]),
        ...statusWarnings(tokenResponse.status, "matrix token"),
        ...(tokenResponse.warnings ?? []).map(sanitizeProviderWarning)
      ];
      const tokenAvailable =
        tokenResult.ok &&
        tokenResponse.tokenAvailable === true &&
        Boolean(tokenResponse.accessToken) &&
        Boolean(tokenResponse.userId) &&
        Boolean(tokenResponse.deviceId) &&
        Boolean(tokenResponse.homeserverBaseUrl) &&
        tokenResponse.e2eeRequired === true;
      const homeserverBaseUrl = tokenResponse.homeserverBaseUrl
        ? clientSafeHomeserverBaseUrl(tokenResponse.homeserverBaseUrl, this.config)
        : undefined;
      if (tokenResponse.homeserverBaseUrl && homeserverBaseUrl !== tokenResponse.homeserverBaseUrl) {
        warnings.push("Matrix homeserver URL was rewritten to the configured public HTTPS endpoint for browser use.");
      } else if (tokenResponse.homeserverBaseUrl?.startsWith("http://")) {
        warnings.push("Matrix homeserver URL is plain HTTP; browser chat may be blocked from the public HTTPS COP.");
      }
      if (!tokenAvailable) {
        warnings.push("Matrix user token is not available or is missing required E2EE bootstrap fields.");
      }
      const status: MessagingIntegrationRuntimeStatus = tokenAvailable ? "online" : "degraded";
      return {
        ...(tokenAvailable && tokenResponse.accessToken ? { accessToken: tokenResponse.accessToken } : {}),
        chatAvailable: tokenAvailable,
        contractVersion: "cop-messaging-bootstrap-v1",
        ...(tokenResponse.deviceId ? { deviceId: tokenResponse.deviceId } : {}),
        ...(tokenResponse.e2eeRequired !== undefined ? { e2eeRequired: tokenResponse.e2eeRequired } : {}),
        enabled: true,
        ...(tokenResponse.expiresAt ? { expiresAt: tokenResponse.expiresAt } : {}),
        ...(homeserverBaseUrl ? { homeserverBaseUrl } : {}),
        providerId: "csm.messaging",
        ...(tokenResponse.serverName ? { serverName: tokenResponse.serverName } : {}),
        status,
        tokenAvailable,
        ...(tokenResponse.userId ? { userId: tokenResponse.userId } : {}),
        warnings: Array.from(new Set(warnings))
      };
    } catch (error) {
      return degradedMatrixBootstrap(requestNow, this.config, errorMessage(error));
    }
  }

  async completeE2eeResetAuth(
    actor: AuthenticatedActor,
    requestNow: Date,
    input: MessagingE2eeResetAuthRequest
  ): Promise<MessagingE2eeResetAuthResponse> {
    if (!this.config.enabled) {
      return disabledE2eeResetAuth("Messaging provider integration is disabled.");
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/matrix/e2ee/reset-auth`),
        this.config,
        requestNow,
        {
          body: JSON.stringify(input),
          headers: {
            ...actorHeaders(actor, input.deviceId),
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedE2eeResetAuth("Messaging E2EE reset auth response is not valid JSON.");
      }
      const response = normalizeE2eeResetAuthResponse(result.body);
      const warnings = [
        ...(response.contractVersion === "csm-messaging-e2ee-reset-auth-v1"
          ? []
          : [`Messaging E2EE reset auth contract version is ${response.contractVersion ?? "unknown"}.`]),
        ...(response.providerId === "csm.messaging"
          ? []
          : [`Messaging E2EE reset auth provider id is ${response.providerId ?? "unknown"}.`]),
        ...(response.warnings ?? []).map(sanitizeProviderWarning)
      ];
      const completed = result.ok && response.completed === true && response.status === "ready";
      if (!completed) {
        warnings.push("CSM Messaging did not complete Matrix E2EE reset authentication.");
      }
      return {
        completed,
        contractVersion: "cop-messaging-e2ee-reset-auth-v1",
        enabled: true,
        providerId: "csm.messaging",
        status: completed ? "online" : "degraded",
        warnings: Array.from(new Set(warnings))
      };
    } catch (error) {
      return degradedE2eeResetAuth(errorMessage(error));
    }
  }

  async fetchConversations(actor: AuthenticatedActor, requestNow: Date): Promise<MessagingConversationList> {
    if (!this.config.enabled) {
      return disabledConversationList();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/conversations`),
        this.config,
        requestNow,
        {
          headers: actorHeaders(actor)
        }
      );
      if (!isRecord(result.body)) {
        return degradedConversationList("Messaging conversations response is not valid JSON.");
      }
      const normalized = normalizeConversationListResponse(result.body);
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging conversations contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging"
          ? []
          : [`Messaging conversations provider id is ${normalized.providerId ?? "unknown"}.`])
      ];
      return {
        contractVersion: "cop-messaging-conversations-v1",
        conversations: normalized.conversations ?? [],
        count: normalized.count ?? normalized.conversations?.length ?? 0,
        enabled: true,
        providerId: "csm.messaging",
        status: result.ok ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedConversationList(errorMessage(error));
    }
  }

  async fetchConversation(
    actor: AuthenticatedActor,
    requestNow: Date,
    conversationId: string
  ): Promise<MessagingConversationDetailResponse> {
    if (!this.config.enabled) {
      return disabledConversationDetail();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}`),
        this.config,
        requestNow,
        {
          headers: actorHeaders(actor)
        }
      );
      if (isRecord(result.body)) {
        const normalized = normalizeConversationCreateResponse(result.body);
        if (result.ok && normalized.conversation) {
          return {
            contractVersion: "cop-messaging-conversations-v1",
            conversation: normalized.conversation,
            enabled: true,
            providerId: "csm.messaging",
            status: "online",
            warnings: [
              ...(normalized.contractVersion === "csm-messaging-provider-v1"
                ? []
                : [`Messaging conversation detail contract version is ${normalized.contractVersion ?? "unknown"}.`]),
              ...(normalized.providerId === "csm.messaging"
                ? []
                : [`Messaging conversation detail provider id is ${normalized.providerId ?? "unknown"}.`])
            ]
          };
        }
      }

      const fallback = await this.fetchConversations(actor, requestNow);
      const conversation = fallback.conversations.find((item) => item.conversationId === conversationId);
      return {
        contractVersion: "cop-messaging-conversations-v1",
        ...(conversation ? { conversation } : {}),
        enabled: fallback.enabled,
        providerId: "csm.messaging",
        status: fallback.status,
        warnings: Array.from(
          new Set([
            ...fallback.warnings,
            ...(result.ok
              ? []
              : [
                  `Messaging conversation detail endpoint returned HTTP ${result.status}; COP resolved against the conversation list.`
                ])
          ])
        )
      };
    } catch (error) {
      const fallback = await this.fetchConversations(actor, requestNow);
      const conversation = fallback.conversations.find((item) => item.conversationId === conversationId);
      return {
        contractVersion: "cop-messaging-conversations-v1",
        ...(conversation ? { conversation } : {}),
        enabled: fallback.enabled,
        providerId: "csm.messaging",
        status: fallback.status === "online" && conversation ? "online" : fallback.status,
        warnings: Array.from(
          new Set([...fallback.warnings, `Messaging conversation detail fallback was used: ${errorMessage(error)}`])
        )
      };
    }
  }

  async fetchConversationByRoomId(
    actor: AuthenticatedActor,
    requestNow: Date,
    roomId: string
  ): Promise<MessagingConversationDetailResponse> {
    if (!this.config.enabled) {
      return disabledConversationDetail();
    }
    const list = await this.fetchConversations(actor, requestNow);
    const conversation = list.conversations.find((item) => item.matrix?.roomId === roomId);
    if (conversation) {
      return this.fetchConversation(actor, requestNow, conversation.conversationId);
    }
    return {
      contractVersion: "cop-messaging-conversations-v1",
      enabled: list.enabled,
      providerId: "csm.messaging",
      status: list.status,
      warnings: list.warnings
    };
  }

  async createConversation(
    actor: AuthenticatedActor,
    requestNow: Date,
    input: MessagingConversationCreateRequest
  ): Promise<MessagingConversationCreateResponse> {
    if (!this.config.enabled) {
      return disabledConversationCreate();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/conversations`),
        this.config,
        requestNow,
        {
          body: JSON.stringify(input),
          headers: {
            ...actorHeaders(actor),
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedConversationCreate("Messaging conversation create response is not valid JSON.");
      }
      const normalized = normalizeConversationCreateResponse(result.body);
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging conversation contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging"
          ? []
          : [`Messaging conversation provider id is ${normalized.providerId ?? "unknown"}.`])
      ];
      if (!result.ok || !normalized.conversation) {
        warnings.push(`Messaging conversation create returned HTTP ${result.status}.`);
      }
      return {
        contractVersion: "cop-messaging-conversations-v1",
        ...(normalized.conversation ? { conversation: normalized.conversation } : {}),
        enabled: true,
        providerId: "csm.messaging",
        status: result.ok && normalized.conversation ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedConversationCreate(errorMessage(error));
    }
  }

  async resolveMatrixIdentities(
    actor: AuthenticatedActor,
    requestNow: Date,
    userIds: string[]
  ): Promise<MessagingMatrixIdentityResolution> {
    if (!this.config.enabled) {
      return disabledIdentityResolution();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/matrix/identities/resolve`),
        this.config,
        requestNow,
        {
          body: JSON.stringify({ userIds }),
          headers: {
            ...actorHeaders(actor),
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedIdentityResolution("Messaging identity resolution response is not valid JSON.");
      }
      const normalized = normalizeIdentityResolutionResponse(result.body);
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging identity resolution contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging"
          ? []
          : [`Messaging identity resolution provider id is ${normalized.providerId ?? "unknown"}.`])
      ];
      return {
        contractVersion: "cop-messaging-identities-v1",
        enabled: true,
        identities: normalized.identities ?? [],
        providerId: "csm.messaging",
        status: result.ok ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedIdentityResolution(errorMessage(error));
    }
  }

  async addConversationMembers(
    actor: AuthenticatedActor,
    requestNow: Date,
    conversationId: string,
    members: MessagingConversationMember[]
  ): Promise<MessagingConversationMemberSyncResponse> {
    if (!this.config.enabled) {
      return disabledConversationMemberSync();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/members`),
        this.config,
        requestNow,
        {
          body: JSON.stringify({ members }),
          headers: {
            ...actorHeaders(actor),
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedConversationMemberSync("Messaging conversation member sync response is not valid JSON.");
      }
      const normalized = normalizeConversationCreateResponse(result.body);
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging conversation member sync contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging"
          ? []
          : [`Messaging conversation member sync provider id is ${normalized.providerId ?? "unknown"}.`])
      ];
      if (!result.ok || !normalized.conversation) {
        warnings.push(`Messaging conversation member sync returned HTTP ${result.status}.`);
      }
      return {
        contractVersion: "cop-messaging-conversations-v1",
        ...(normalized.conversation ? { conversation: normalized.conversation } : {}),
        enabled: true,
        providerId: "csm.messaging",
        status: result.ok && normalized.conversation ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedConversationMemberSync(errorMessage(error));
    }
  }

  async bindMatrixRoom(
    actor: AuthenticatedActor,
    requestNow: Date,
    conversationId: string,
    input: MessagingMatrixRoomBindingRequest
  ): Promise<MessagingMatrixRoomBindingResponse> {
    if (!this.config.enabled) {
      return disabledRoomBinding();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}/matrix-room`),
        this.config,
        requestNow,
        {
          body: JSON.stringify(input),
          headers: {
            ...actorHeaders(actor),
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedRoomBinding("Messaging matrix-room binding response is not valid JSON.");
      }
      const normalized = normalizeRoomBindingResponse(result.body);
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1"
          ? []
          : [`Messaging room binding contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging"
          ? []
          : [`Messaging room binding provider id is ${normalized.providerId ?? "unknown"}.`])
      ];
      return {
        contractVersion: "cop-messaging-room-binding-v1",
        ...(normalized.conversation ? { conversation: normalized.conversation } : {}),
        enabled: true,
        providerId: "csm.messaging",
        status: result.ok && normalized.conversation ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedRoomBinding(errorMessage(error));
    }
  }

  async sendNotification(
    actor: AuthenticatedActor | undefined,
    requestNow: Date,
    idempotencyKey: string,
    input: MessagingNotificationIntakeRequest
  ): Promise<MessagingNotificationIntakeResponse> {
    if (!this.config.enabled) {
      return disabledNotificationIntake();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/notifications`),
        this.config,
        requestNow,
        {
          body: JSON.stringify(input),
          headers: {
            ...(actor ? actorHeaders(actor) : {}),
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedNotificationIntake("Messaging notification response is not valid JSON.");
      }
      const normalized = normalizeNotificationResponse(result.body);
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1"
          ? []
          : normalized.contractVersion === "csm-notification-v1"
            ? []
            : [`Messaging notification contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging"
          ? []
          : [`Messaging notification provider id is ${normalized.providerId ?? "unknown"}.`]),
        ...(normalized.warnings ?? []).map(sanitizeProviderWarning)
      ];
      if (!result.ok || !normalized.notificationId) {
        warnings.push(`Messaging notification intake returned HTTP ${result.status}.`);
      }
      return {
        contractVersion: "cop-messaging-notification-v1",
        ...(typeof normalized.deduplicated === "boolean" ? { deduplicated: normalized.deduplicated } : {}),
        enabled: true,
        ...(normalized.notificationId ? { notificationId: normalized.notificationId } : {}),
        providerId: "csm.messaging",
        status: result.ok && normalized.notificationId ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedNotificationIntake(errorMessage(error));
    }
  }

  async forwardMatrixPushNotification(
    requestNow: Date,
    input: unknown
  ): Promise<MessagingMatrixPushGatewayForwardResponse> {
    if (!this.config.enabled) {
      return {
        body: { rejected: [] },
        ok: false,
        status: "disabled",
        statusCode: 503,
        warnings: ["Messaging provider is disabled."]
      };
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/matrix/push/notify`),
        this.config,
        requestNow,
        {
          body: JSON.stringify(input ?? {}),
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      return {
        body: normalizeMatrixPushGatewayResponse(result.body),
        ok: result.ok,
        status: result.ok ? "online" : "degraded",
        statusCode: result.status,
        warnings: result.ok ? [] : [`Messaging Matrix push gateway returned HTTP ${result.status}.`]
      };
    } catch (error) {
      return {
        body: { rejected: [] },
        ok: false,
        status: "degraded",
        statusCode: 502,
        warnings: [`Messaging Matrix push gateway forward failed: ${errorMessage(error)}`]
      };
    }
  }

  async registerWebPushDevice(
    actor: AuthenticatedActor,
    requestNow: Date,
    input: MessagingWebPushDeviceRegistrationRequest
  ): Promise<MessagingWebPushDeviceRegistrationResponse> {
    if (!this.config.enabled || !this.config.webPushEnabled) {
      return disabledWebPushDeviceRegistration();
    }
    if (!this.config.webPushVapidPublicKey) {
      return degradedWebPushDeviceRegistration("Browser notification public key is not configured.");
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/devices`),
        this.config,
        requestNow,
        {
          body: JSON.stringify({
            ...(input.capabilities ? { capabilities: input.capabilities } : {}),
            deviceId: input.deviceId,
            ...(input.locale ? { locale: input.locale } : {}),
            ...(input.notificationPreferences ? { notificationPreferences: input.notificationPreferences } : {}),
            platform: "web",
            pushProvider: "webpush",
            pushSubscription: {
              endpoint: input.endpoint,
              keys: input.keys
            },
            ...(input.timezone ? { timezone: input.timezone } : {})
          }),
          headers: {
            ...actorHeaders(actor, input.deviceId),
            "Content-Type": "application/json"
          },
          method: "POST"
        }
      );
      if (!isRecord(result.body)) {
        return degradedWebPushDeviceRegistration("Messaging device registration response is not valid JSON.");
      }
      const normalized = normalizeWebPushDeviceResponse(result.body);
      const registered =
        result.ok &&
        (normalized.registered === true ||
          (normalized.registered !== false && isSuccessfulWebPushDeviceStatus(normalized.status)));
      const warnings = [
        ...(normalized.contractVersion === "csm-messaging-provider-v1" || normalized.contractVersion === "csm-device-v1"
          ? []
          : [`Messaging device contract version is ${normalized.contractVersion ?? "unknown"}.`]),
        ...(normalized.providerId === "csm.messaging" || !normalized.providerId
          ? []
          : [`Messaging device provider id is ${normalized.providerId}.`]),
        ...(normalized.warnings ?? []).map(sanitizeProviderWarning)
      ];
      if (!registered) {
        warnings.push(`Messaging device registration returned HTTP ${result.status}.`);
      }
      const responseDeviceId = normalized.deviceId ?? input.deviceId;
      return {
        contractVersion: "cop-web-push-device-v1",
        deviceId: responseDeviceId,
        enabled: true,
        providerId: "csm.messaging",
        registered,
        status: registered ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedWebPushDeviceRegistration(errorMessage(error));
    }
  }

  async deleteWebPushDevice(
    actor: AuthenticatedActor,
    requestNow: Date,
    deviceId: string
  ): Promise<MessagingWebPushDeviceDeletionResponse> {
    if (!this.config.enabled || !this.config.webPushEnabled) {
      return disabledWebPushDeviceDeletion();
    }
    try {
      const result = await fetchJsonWithStatus(
        new URL(`${this.config.baseUrl}/api/v1/devices/${encodeURIComponent(deviceId)}`),
        this.config,
        requestNow,
        {
          headers: actorHeaders(actor, deviceId),
          method: "DELETE"
        }
      );
      const warnings = result.ok ? [] : [`Messaging device delete returned HTTP ${result.status}.`];
      return {
        contractVersion: "cop-web-push-device-v1",
        deleted: result.ok,
        deviceId,
        enabled: true,
        providerId: "csm.messaging",
        status: result.ok ? "online" : "degraded",
        warnings
      };
    } catch (error) {
      return degradedWebPushDeviceDeletion(errorMessage(error), deviceId);
    }
  }
}

export function disabledMessagingStatus(
  requestNow: Date,
  config: MessagingProviderConfig = defaultConfig
): MessagingProviderStatus {
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

function degradedMessagingStatus(
  requestNow: Date,
  config: MessagingProviderConfig,
  detail: string
): MessagingProviderStatus {
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

function disabledMatrixBootstrap(
  _requestNow: Date,
  config: MessagingProviderConfig = defaultConfig
): MessagingMatrixBootstrap {
  return {
    chatAvailable: false,
    contractVersion: "cop-messaging-bootstrap-v1",
    detail: "Messaging provider integration is disabled by COP_CSM_MESSAGING_ENABLED.",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    tokenAvailable: false,
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedMatrixBootstrap(
  _requestNow: Date,
  config: MessagingProviderConfig,
  detail: string
): MessagingMatrixBootstrap {
  return {
    chatAvailable: false,
    contractVersion: "cop-messaging-bootstrap-v1",
    detail,
    enabled: config.enabled,
    providerId: "csm.messaging",
    status: "degraded",
    tokenAvailable: false,
    warnings: [detail]
  };
}

function disabledE2eeResetAuth(detail: string): MessagingE2eeResetAuthResponse {
  return {
    completed: false,
    contractVersion: "cop-messaging-e2ee-reset-auth-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: [detail]
  };
}

function degradedE2eeResetAuth(detail: string): MessagingE2eeResetAuthResponse {
  return {
    completed: false,
    contractVersion: "cop-messaging-e2ee-reset-auth-v1",
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledConversationList(): MessagingConversationList {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    conversations: [],
    count: 0,
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedConversationList(detail: string): MessagingConversationList {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    conversations: [],
    count: 0,
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledConversationCreate(): MessagingConversationCreateResponse {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedConversationCreate(detail: string): MessagingConversationCreateResponse {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledConversationDetail(): MessagingConversationDetailResponse {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function disabledConversationMemberSync(): MessagingConversationMemberSyncResponse {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedConversationMemberSync(detail: string): MessagingConversationMemberSyncResponse {
  return {
    contractVersion: "cop-messaging-conversations-v1",
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledIdentityResolution(): MessagingMatrixIdentityResolution {
  return {
    contractVersion: "cop-messaging-identities-v1",
    enabled: false,
    identities: [],
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedIdentityResolution(detail: string): MessagingMatrixIdentityResolution {
  return {
    contractVersion: "cop-messaging-identities-v1",
    enabled: true,
    identities: [],
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledRoomBinding(): MessagingMatrixRoomBindingResponse {
  return {
    contractVersion: "cop-messaging-room-binding-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedRoomBinding(detail: string): MessagingMatrixRoomBindingResponse {
  return {
    contractVersion: "cop-messaging-room-binding-v1",
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledNotificationIntake(): MessagingNotificationIntakeResponse {
  return {
    contractVersion: "cop-messaging-notification-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Messaging provider is disabled."]
  };
}

function degradedNotificationIntake(detail: string): MessagingNotificationIntakeResponse {
  return {
    contractVersion: "cop-messaging-notification-v1",
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledWebPushConfig(detail: string): MessagingWebPushConfigResponse {
  return {
    contractVersion: "cop-web-push-config-v1",
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: [detail]
  };
}

function degradedWebPushConfig(detail: string): MessagingWebPushConfigResponse {
  return {
    contractVersion: "cop-web-push-config-v1",
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function disabledWebPushDeviceRegistration(): MessagingWebPushDeviceRegistrationResponse {
  return {
    contractVersion: "cop-web-push-device-v1",
    enabled: false,
    providerId: "csm.messaging",
    registered: false,
    status: "disabled",
    warnings: ["Browser notifications are disabled."]
  };
}

function degradedWebPushDeviceRegistration(detail: string): MessagingWebPushDeviceRegistrationResponse {
  return {
    contractVersion: "cop-web-push-device-v1",
    enabled: true,
    providerId: "csm.messaging",
    registered: false,
    status: "degraded",
    warnings: [detail]
  };
}

function disabledWebPushDeviceDeletion(): MessagingWebPushDeviceDeletionResponse {
  return {
    contractVersion: "cop-web-push-device-v1",
    deleted: false,
    enabled: false,
    providerId: "csm.messaging",
    status: "disabled",
    warnings: ["Browser notifications are disabled."]
  };
}

function degradedWebPushDeviceDeletion(detail: string, deviceId?: string): MessagingWebPushDeviceDeletionResponse {
  return {
    contractVersion: "cop-web-push-device-v1",
    deleted: false,
    ...(deviceId ? { deviceId } : {}),
    enabled: true,
    providerId: "csm.messaging",
    status: "degraded",
    warnings: [detail]
  };
}

function isSuccessfulWebPushDeviceStatus(status: string | undefined): boolean {
  return (
    status === "active" || status === "accepted" || status === "ok" || status === "online" || status === "registered"
  );
}

async function fetchJsonWithStatus(
  url: URL,
  config: MessagingProviderConfig,
  requestNow: Date,
  options: { body?: string; headers?: Record<string, string>; method?: "DELETE" | "GET" | "POST" } = {}
): Promise<{ body: unknown; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-COP-Request-At": requestNow.toISOString(),
      ...(options.headers ?? {})
    };
    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(url, {
      ...(options.body ? { body: options.body } : {}),
      headers: safeHeaderRecord(headers),
      method: options.method ?? "GET",
      signal: controller.signal
    });
    const text = await response.text();
    return {
      body: text ? (JSON.parse(text) as unknown) : {},
      ok: response.ok,
      status: response.status
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkPublicMatrixHomeserver(config: MessagingProviderConfig): Promise<{ detail: string; ok: boolean }> {
  const baseUrl = config.matrixHomeserverPublicUrl;
  if (!baseUrl) {
    return {
      detail: "Matrix public homeserver URL is not configured for browser use.",
      ok: false
    };
  }
  if (!baseUrl.startsWith("https://")) {
    return {
      detail: "Matrix public homeserver URL must use HTTPS for browser chat.",
      ok: false
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(new URL("/_matrix/client/versions", baseUrl), {
      headers: {
        Accept: "application/json"
      },
      method: "GET",
      signal: controller.signal
    });
    return response.ok
      ? { detail: "Matrix public homeserver is reachable.", ok: true }
      : { detail: `Matrix public homeserver returned HTTP ${response.status}.`, ok: false };
  } catch (error) {
    return {
      detail: `Matrix public homeserver is not reachable from COP server: ${errorMessage(error)}`,
      ok: false
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
      ? value.checks.flatMap((check): Array<{ id?: string; message?: string; status?: string }> =>
          isRecord(check)
            ? [
                {
                  id: optionalString(check.id),
                  message: optionalString(check.message),
                  status: optionalString(check.status)
                }
              ]
            : []
        )
      : undefined,
    status: optionalString(value.status)
  };
}

function normalizeMatrixPushGatewayResponse(value: unknown): MatrixPushGatewayResponse {
  if (!isRecord(value) || !Array.isArray(value.rejected)) {
    return { rejected: [] };
  }
  return {
    rejected: value.rejected.filter((item): item is string => typeof item === "string")
  };
}

function normalizeMatrixTokenResponse(value: Record<string, unknown>): CsmMessagingMatrixTokenResponse {
  return {
    accessToken: optionalString(value.accessToken),
    contractVersion: optionalString(value.contractVersion),
    deviceId: optionalString(value.deviceId),
    e2eeRequired: typeof value.e2eeRequired === "boolean" ? value.e2eeRequired : undefined,
    expiresAt: optionalString(value.expiresAt),
    homeserverBaseUrl: optionalString(value.homeserverBaseUrl),
    providerId: optionalString(value.providerId),
    serverName: optionalString(value.serverName),
    status: optionalString(value.status),
    tokenAvailable: typeof value.tokenAvailable === "boolean" ? value.tokenAvailable : undefined,
    userId: optionalString(value.userId),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : undefined
  };
}

function normalizeE2eeResetAuthResponse(value: Record<string, unknown>): CsmMessagingE2eeResetAuthProviderResponse {
  return {
    completed: typeof value.completed === "boolean" ? value.completed : undefined,
    contractVersion: optionalString(value.contractVersion),
    providerId: optionalString(value.providerId),
    status: optionalString(value.status),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : undefined
  };
}

function normalizeConversationListResponse(
  value: Record<string, unknown>
): CsmMessagingConversationListResponse & { conversations?: MessagingConversationSummary[] } {
  return {
    contractVersion: optionalString(value.contractVersion),
    conversations: Array.isArray(value.conversations)
      ? value.conversations.flatMap(normalizeConversationSummary)
      : undefined,
    count:
      typeof value.count === "number" && Number.isFinite(value.count)
        ? Math.max(0, Math.round(value.count))
        : undefined,
    providerId: optionalString(value.providerId)
  };
}

function normalizeConversationCreateResponse(
  value: Record<string, unknown>
): CsmMessagingConversationCreateProviderResponse & { conversation?: MessagingConversationSummary } {
  return {
    contractVersion: optionalString(value.contractVersion),
    conversation: normalizeConversationSummary(value.conversation)[0],
    providerId: optionalString(value.providerId)
  };
}

function normalizeIdentityResolutionResponse(
  value: Record<string, unknown>
): CsmMessagingIdentityResolutionProviderResponse & { identities?: MessagingMatrixIdentity[] } {
  const values = Array.isArray(value.identities) ? value.identities : Array.isArray(value.items) ? value.items : [];
  return {
    contractVersion: optionalString(value.contractVersion),
    identities: values.flatMap(normalizeMatrixIdentity),
    items: undefined,
    providerId: optionalString(value.providerId)
  };
}

function normalizeRoomBindingResponse(
  value: Record<string, unknown>
): CsmMessagingRoomBindingProviderResponse & { conversation?: MessagingConversationSummary } {
  return {
    contractVersion: optionalString(value.contractVersion),
    conversation: normalizeConversationSummary(value.conversation)[0],
    providerId: optionalString(value.providerId)
  };
}

function normalizeNotificationResponse(value: Record<string, unknown>): CsmMessagingNotificationProviderResponse {
  const notification = isRecord(value.notification) ? value.notification : value;
  return {
    contractVersion: optionalString(value.contractVersion),
    deduplicated:
      typeof notification.deduplicated === "boolean"
        ? notification.deduplicated
        : typeof value.deduplicated === "boolean"
          ? value.deduplicated
          : undefined,
    notificationId:
      optionalString(notification.notificationId) ??
      optionalString(notification.id) ??
      optionalString(value.notificationId) ??
      optionalString(value.id),
    providerId: optionalString(value.providerId),
    status: optionalString(value.status) ?? optionalString(notification.status),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : undefined
  };
}

function normalizeWebPushDeviceResponse(value: Record<string, unknown>): CsmMessagingWebPushDeviceProviderResponse {
  const nestedDevice = isRecord(value.device) ? value.device : undefined;
  const nestedStatus = nestedDevice ? optionalString(nestedDevice.status) : undefined;
  return {
    contractVersion: optionalString(value.contractVersion),
    deviceId:
      optionalString(value.deviceId) ??
      optionalString(value.id) ??
      (nestedDevice ? optionalString(nestedDevice.deviceId) : undefined),
    providerId: optionalString(value.providerId),
    registered: typeof value.registered === "boolean" ? value.registered : undefined,
    status: optionalString(value.status) ?? (nestedStatus === "active" ? "registered" : nestedStatus),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : undefined
  };
}

function normalizeMatrixIdentity(value: unknown): MessagingMatrixIdentity[] {
  if (!isRecord(value)) {
    return [];
  }
  const userId = optionalString(value.userId) ?? optionalString(value.csmUserId) ?? optionalString(value.subjectId);
  const matrixUserId = optionalString(value.matrixUserId) ?? optionalString(value.matrixId);
  if (!userId || !matrixUserId) {
    return [];
  }
  return [
    {
      ...(normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url)
        ? { avatarUrl: normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url) }
        : {}),
      ...(optionalString(value.displayName) ? { displayName: optionalString(value.displayName) } : {}),
      matrixUserId,
      userId
    }
  ];
}

function normalizeConversationSummary(value: unknown): MessagingConversationSummary[] {
  if (!isRecord(value)) {
    return [];
  }
  const conversationId = optionalString(value.conversationId);
  const title = optionalString(value.title);
  const type = optionalString(value.type);
  const rawKind = optionalString(value.conversationKind) ?? optionalString(value.kind);
  const conversationKind =
    rawKind === "personal_ai" || rawKind === "direct" || rawKind === "group"
      ? rawKind
      : type === "direct"
        ? "direct"
        : "group";
  if (!conversationId || !title || (type !== "direct" && type !== "group")) {
    return [];
  }
  const matrix = isRecord(value.matrix)
    ? {
        ...(optionalString(value.matrix.homeserverBaseUrl)
          ? { homeserverBaseUrl: optionalString(value.matrix.homeserverBaseUrl) }
          : {}),
        ...(optionalString(value.matrix.roomId)
          ? { roomId: optionalString(value.matrix.roomId) }
          : value.matrix.roomId === null
            ? { roomId: null }
            : {}),
        ...(optionalString(value.matrix.serverName) ? { serverName: optionalString(value.matrix.serverName) } : {}),
        ...(optionalString(value.matrix.state) ? { state: optionalString(value.matrix.state) } : {})
      }
    : undefined;
  const members = Array.isArray(value.members) ? value.members.flatMap(normalizeConversationMember) : undefined;
  const metadata = isRecord(value.metadata) ? normalizeSafeMetadata(value.metadata) : undefined;
  const directPeer = normalizeDirectPeer(value.directPeer ?? value.peer ?? value.direct_peer);
  return [
    {
      ...(normalizeAvatarDataUrl(value.avatarDataUrl ?? value.avatar_data_url)
        ? { avatarDataUrl: normalizeAvatarDataUrl(value.avatarDataUrl ?? value.avatar_data_url) }
        : {}),
      ...(normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url)
        ? { avatarUrl: normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url) }
        : {}),
      ...(optionalString(value.canonicalKey) ? { canonicalKey: optionalString(value.canonicalKey) } : {}),
      conversationId,
      conversationKind,
      ...(optionalString(value.createdAt) ? { createdAt: optionalString(value.createdAt) } : {}),
      ...(optionalString(value.disclaimer) ? { disclaimer: optionalString(value.disclaimer) } : {}),
      ...(directPeer ? { directPeer } : {}),
      ...(typeof value.e2eeRequired === "boolean" ? { e2eeRequired: value.e2eeRequired } : {}),
      ...(typeof value.encrypted === "boolean" ? { encrypted: value.encrypted } : {}),
      ...(typeof value.mapLinkCount === "number" ? { mapLinkCount: Math.max(0, Math.round(value.mapLinkCount)) } : {}),
      ...(matrix ? { matrix } : {}),
      ...(typeof value.memberCount === "number" ? { memberCount: Math.max(0, Math.round(value.memberCount)) } : {}),
      ...(members ? { members } : {}),
      ...(metadata ? { metadata } : {}),
      ...(optionalString(value.status) ? { status: optionalString(value.status) } : {}),
      title,
      type,
      ...(optionalString(value.updatedAt) ? { updatedAt: optionalString(value.updatedAt) } : {})
    }
  ];
}

function normalizeSafeMetadata(value: Record<string, unknown>): MessagingConversationSummary["metadata"] | undefined {
  const metadata: NonNullable<MessagingConversationSummary["metadata"]> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/u.test(key)) {
      continue;
    }
    const normalized = normalizeSafeMetadataValue(rawValue);
    if (normalized !== undefined) {
      metadata[key] = normalized;
    }
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function normalizeDirectPeer(value: unknown): MessagingConversationSummary["directPeer"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const userId = optionalString(value.userId) ?? optionalString(value.id) ?? optionalString(value.subjectId);
  if (!userId) {
    return undefined;
  }
  return {
    ...(normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url)
      ? { avatarUrl: normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url) }
      : {}),
    ...(optionalString(value.displayName) ? { displayName: optionalString(value.displayName) } : {}),
    userId
  };
}

function normalizeSafeMetadataValue(
  value: unknown
): string | number | boolean | null | Array<string | number | boolean | null> | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return value.slice(0, 512);
  }
  if (Array.isArray(value)) {
    const values = value
      .map(normalizeSafeMetadataValue)
      .filter(
        (item): item is string | number | boolean | null =>
          item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      )
      .slice(0, 50);
    return values.length ? values : undefined;
  }
  return undefined;
}

function normalizeConversationMember(value: unknown): MessagingConversationMember[] {
  if (!isRecord(value)) {
    return [];
  }
  const userId = optionalString(value.userId);
  if (!userId) {
    return [];
  }
  return [
    {
      ...(normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url)
        ? { avatarUrl: normalizeAvatarUrl(value.avatarUrl ?? value.avatar_url) }
        : {}),
      ...(optionalString(value.displayName) ? { displayName: optionalString(value.displayName) } : {}),
      ...(optionalString(value.role) ? { role: optionalString(value.role) } : {}),
      userId
    }
  ];
}

function normalizeAvatarUrl(value: unknown): string | undefined {
  const avatarUrl = optionalString(value);
  if (!avatarUrl) {
    return undefined;
  }
  if (avatarUrl.startsWith("mxc://") || avatarUrl.startsWith("data:image/")) {
    return avatarUrl;
  }
  try {
    const url = new URL(avatarUrl);
    return url.protocol === "https:" ? avatarUrl : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAvatarDataUrl(value: unknown): string | undefined {
  const avatarDataUrl = optionalString(value);
  return avatarDataUrl?.startsWith("data:image/") ? avatarDataUrl : undefined;
}

function healthCheckWarnings(health: CsmMessagingHealth | undefined): string[] {
  return (health?.checks ?? []).flatMap((check) => {
    if (isOperationalStatus(check.status)) {
      return [];
    }
    const rawMessage = check.message ?? check.status ?? "degraded";
    if (containsSensitiveConfigHint(check.id) || containsSensitiveConfigHint(rawMessage)) {
      return ["Messaging Matrix token bootstrap configuration is incomplete."];
    }
    return [`${check.id ?? "check"}: ${sanitizeProviderWarning(rawMessage)}`];
  });
}

function statusWarnings(status: string | undefined, label: string): string[] {
  return isOperationalStatus(status) ? [] : [`Messaging ${label} status is ${status ?? "unknown"}.`];
}

function isOperationalStatus(status: string | undefined): boolean {
  const normalized = status?.toLowerCase();
  return normalized === "ok" || normalized === "online" || normalized === "ready";
}

function hasClientSafeMessagingHealth(health: CsmMessagingHealth | undefined): boolean {
  if (!health || isOperationalStatus(health.status)) {
    return true;
  }
  const degradedChecks = health.checks?.filter((check) => !isOperationalStatus(check.status)) ?? [];
  return degradedChecks.every((check) => !isClientMessagingBlockingHealthCheck(check));
}

function isClientMessagingBlockingHealthCheck(check: { id?: string; message?: string; status?: string }): boolean {
  const id = check.id?.toLowerCase() ?? "";
  if (!id) {
    return true;
  }
  if (id === "apns" || id === "web_push" || id === "notification_delivery" || id === "notification_store") {
    return false;
  }
  return /matrix|metadata|identity|device|token|server|store|database|postgres|redis|oidc|config/u.test(id);
}

function sanitizeProviderWarning(warning: string): string {
  if (containsSensitiveConfigHint(warning)) {
    return "Messaging provider has incomplete server-side credential configuration.";
  }
  return warning;
}

function containsSensitiveConfigHint(value: string | undefined): boolean {
  return /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ADMIN)[A-Z0-9_]*\b/u.test(value ?? "");
}

function isClientSafeMatrixBootstrapReady(
  capabilities: CsmMessagingCapabilities,
  providerOk: boolean,
  healthOk: boolean
): boolean {
  return (
    providerOk &&
    healthOk &&
    capabilities.features?.matrixTokenBootstrap === true &&
    capabilities.features?.matrixIdentityResolution === true &&
    capabilities.features?.matrixRoomBinding === true &&
    capabilities.features?.endToEndEncryptionRequired === true &&
    capabilities.security?.readFromBrowser === false &&
    capabilities.architecture?.plaintextOnServer !== true
  );
}

function actorHeaders(actor: AuthenticatedActor, deviceId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-csm-user-id": safeHeaderValue(actor.subjectId, "unknown"),
    "x-csm-user-name": safeHeaderValue(actor.displayName || actor.username, actor.subjectId),
    "x-csm-user-role": safeHeaderValue(actor.roles?.[0] ?? actor.authMode, "user")
  };

  if (deviceId) {
    headers["x-csm-device-id"] = safeHeaderValue(deviceId, "COPWEB.device");
  }

  return headers;
}

function safeHeaderValue(value: string | undefined, fallback: string): string {
  const normalized = (value?.trim() || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\x20-\x7E]/gu, "");
  const collapsed = normalized.replace(/\s+/gu, " ").trim();
  return collapsed || fallback.replace(/[^\x20-\x7E]/gu, "").trim() || "unknown";
}

function safeHeaderRecord(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, safeHeaderValue(value, value)]));
}

function clientSafeHomeserverBaseUrl(providerBaseUrl: string, config: MessagingProviderConfig): string {
  const publicBaseUrl = config.matrixHomeserverPublicUrl ?? "";
  if (!publicBaseUrl) {
    return providerBaseUrl;
  }
  if (providerBaseUrl.startsWith("http://") || providerBaseUrl.includes("docker.home.cz")) {
    return trimTrailingSlash(publicBaseUrl);
  }
  return providerBaseUrl;
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
