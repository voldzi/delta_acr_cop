# 09 CSM Messaging Integration

## Purpose

CSM Messaging is a standalone communication provider for the Civil Situation
Map. It is not a SIM data source and COP must not couple to its database,
Matrix homeserver internals or service tokens.

The current integration is intentionally limited to provider capability and
health discovery. It prepares the application shell for a chat window without
turning the pilot baseline into a production messaging client.

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
    "eventLinks": true
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

`chatAvailable` stays `false` until a separate client-safe Matrix/E2EE
bootstrap contract is available and implemented.

## Runtime Configuration

```env
COP_CSM_MESSAGING_ENABLED=false
COP_CSM_MESSAGING_BASE_URL=http://docker.home.cz:4050
COP_CSM_MESSAGING_PUBLIC_URL=https://msg.zeleznalady.cz
COP_CSM_MESSAGING_TIMEOUT_MS=3000
COP_CSM_MESSAGING_CACHE_TTL_MS=10000
COP_WEB_MESSAGING_LAUNCHER_ENABLED=true
```

`COP_CSM_MESSAGING_ENABLED=false` means the chat launcher can still be visible,
but it will show an integration/disabled state instead of opening
conversations.

## Security Rules

- The browser never calls the Messaging provider directly.
- COP does not proxy plaintext messages through the Phoenix API.
- Provider credentials and Matrix service/admin tokens stay server-side.
- User identity comes from the COP login session. Anonymous users may use the
  map, but they cannot participate in messaging.
- Production chat requires a dedicated Matrix/E2EE client bootstrap contract.

## Next Contract Needed For Real Chat

Messaging must provide a client-safe contract for:

```http
GET /api/v1/me
GET /api/v1/conversations
POST /api/v1/conversations
POST /api/v1/matrix/token
POST /api/v1/conversations/{conversationId}/map-links
```

The Matrix token endpoint must be scoped to the authenticated user and must not
grant administrative or service-level capabilities.
