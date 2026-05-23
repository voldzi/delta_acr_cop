# 09 CSM Messaging Integration

## Purpose

CSM Messaging is a standalone communication provider for the Civil Situation
Map. It is not a SIM data source and COP must not couple to its database,
Matrix homeserver internals or service tokens.

The current integration reads provider capability and health discovery and is
ready for server-side metadata calls. It prepares the application shell for a
chat window without turning the pilot baseline into a plaintext message proxy.

## Current Provider Contract

COP reads the provider only from the API server:

```http
GET /api/v1/capabilities
GET /health/ready
```

Expected provider baseline:

```json
{
  "contractVersion": "csm-messaging-provider-v1",
  "providerId": "csm.messaging",
  "serviceName": "CSM Messaging",
  "status": "online",
  "architecture": {
    "mode": "matrix-backed",
    "serverRole": "policy-and-integration",
    "plaintextOnServer": false
  },
  "features": {
    "directMessages": true,
    "groups": true,
    "endToEndEncryptionRequired": true,
    "mapObjectLinks": true,
    "eventLinks": true,
    "conversationMetadata": true,
    "matrixTokenBootstrap": true
  },
  "endpoints": {
    "me": "/api/v1/me",
    "conversations": "/api/v1/conversations",
    "matrixToken": "/api/v1/matrix/token"
  },
  "security": {
    "authMode": "csm-server-token",
    "readFromBrowser": false,
    "serverSideIntegrationOnly": true,
    "metadataMinimization": true
  }
}
```

## COP API

COP exposes only a normalized status endpoint to web and native clients:

```http
GET /api/v1/messaging/status
```

This endpoint is a server-side bridge. It must not return provider service
tokens, Matrix admin tokens, database credentials or message payloads.

`chatAvailable` is `true` only when the provider reports a client-safe
Matrix/E2EE bootstrap contract:

- `features.matrixTokenBootstrap=true`
- `features.endToEndEncryptionRequired=true`
- `security.readFromBrowser=false`
- `architecture.plaintextOnServer=false`
- provider capability and health status are operational

The public status response must never contain Matrix user tokens, provider
tokens, Synapse admin tokens or message payloads.

Authenticated clients open chat through:

```http
POST /api/v1/messaging/bootstrap
Authorization: Bearer <COP user access token>
```

COP then calls CSM Messaging server-side:

```http
POST /api/v1/matrix/token
Authorization: Bearer <COP_CSM_MESSAGING_TOKEN>
x-csm-user-id: <authenticated COP user id>
x-csm-user-name: <display name>
x-csm-user-role: <role>
```

The bootstrap endpoint may return a short-lived Matrix user token to the web
client. That token is scoped to the authenticated user. It is not a provider,
admin or service token.

After bootstrap, the browser sends and reads messages directly through
Matrix client-server APIs using Matrix SDK and E2EE. COP must not add any
plaintext message send/read endpoints.

## Runtime Configuration

```env
COP_CSM_MESSAGING_ENABLED=true
COP_CSM_MESSAGING_BASE_URL=http://docker.home.cz:4050
COP_CSM_MESSAGING_PUBLIC_URL=https://msg.zeleznalady.cz
COP_CSM_MESSAGING_TOKEN=<same-value-as-CSM_MESSAGING_API_TOKEN>
COP_CSM_MESSAGING_TIMEOUT_MS=3000
COP_CSM_MESSAGING_CACHE_TTL_MS=10000
COP_WEB_MESSAGING_LAUNCHER_ENABLED=true
```

If `COP_CSM_MESSAGING_ENABLED=false`, the chat launcher can still be visible,
but it will show an integration/disabled state instead of opening
conversations.

## Security Rules

- The browser never calls the Messaging provider directly.
- COP does not proxy plaintext messages through the Phoenix API.
- Provider credentials and Matrix service/admin tokens stay server-side.
- If CSM Messaging runs with `CSM_MESSAGING_REQUIRE_AUTH=true`, COP must set
  `COP_CSM_MESSAGING_TOKEN` to the same value as `CSM_MESSAGING_API_TOKEN`.
- User identity comes from the COP login session. Anonymous users may use the
  map, but they cannot participate in messaging.
- Production chat requires a dedicated Matrix/E2EE client bootstrap contract.

## Metadata Flow

Messaging now exposes server-side metadata endpoints:

```http
GET /api/v1/me
GET /api/v1/conversations
POST /api/v1/conversations
POST /api/v1/matrix/token
POST /api/v1/conversations/{conversationId}/map-links
```

COP must call those endpoints only from the API server with:

```http
Authorization: Bearer <COP_CSM_MESSAGING_TOKEN>   # when required
x-csm-user-id: <authenticated COP user id>
x-csm-user-name: <display name>
x-csm-user-role: <role>
```

The Matrix token endpoint must remain scoped to the authenticated user and must
not grant administrative or service-level capabilities. `chatAvailable` is
derived from provider metadata only; the actual `accessToken` is returned only
from the authenticated bootstrap endpoint.
