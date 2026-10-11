# Scoped voice admission deployment candidate

This is a source handoff, not an active production configuration. Existing
`compose.yml` and `livekit.yaml` are unchanged. Do not publish a new port or
alter firewall/network segmentation as part of this source change.

## Required coordinated deployment

1. Build the exact published COP revision. The separate compiled entry is
   `apps/cop-api/dist/voice-admission-main.js` (`start:voice-gateway`). Provision
   it as one supervised process/container with the existing COP PostgreSQL
   connection, verified OIDC issuer/dedicated Jízda client and existing LiveKit
   API key/secret. Do not expose all other COP credentials to this process.
2. Configure `COP_VOICE_SIGNAL_GATEWAY_BACKEND_URL` as the private existing SFU
   origin, `COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL` as the private gateway origin,
   and the same `COP_VOICE_SCOPED_GRANT_MAX_AGE_SECONDS` on API and gateway.
   The listener defaults to127.0.0.1:7884. In a container its reachable bind
   address/network must be explicitly reviewed; default localhost does not
   create a shared container network.
3. Route every `/rtc`, `/rtc/validate`, `/rtc/v1`, `/rtc/v1/validate` request to
   the gateway, preserving WebSocket upgrades and protocol payloads. Disable
   retries of admission requests and request-URI/query/header/body logging.
   Keep internal `/internal/voice-grants/revoke` reachable only by COP API.
4. Independently authorize and close every direct/alternative signaling route
   to SFU port7880. Preserve media UDP7882/TCP7881, TURN and the same existing
   SFU for cross-app calls. Test external networks and legacy COP Mobile.
5. In the separately reviewed provider config set and verify the effective
   `signal_relay.connect_attempts: 1` for pinned LiveKit v1.13.3. No proxy retry
   may create another late dispatch. Defaults contain more than one attempt.
6. Exercise the provider/owner/crash/rejoin gates in integration45 before
   setting `COP_VOICE_SIGNAL_GATEWAY_ACCEPTED=true` and
   `COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED=true`. Their presence in a config
   file is not evidence that topology or retries have been accepted.
7. Only after coordinated acceptance enable Jízda scoped intake. Do not enable
   legacy migration, unlink completion or whole-account erasure implicitly.

## Rollback

Before real scoped grants exist, keep intake off and revert only the source
candidate. After any scoped grant/fence exists, disable new intake while keeping
the persistent ledger, exact configuration/identity key, admission gateway and
revocation maintenance. Do not restore direct signaling or erase unresolved
handshake rows. Never downgrade a scoped Jízda request to a legacy identity.
Known legacy callers keep their existing signed identity and media transport.

The candidate does not independently establish live provider revocation,
network isolation, a real PostgreSQL lease failover, physical device behavior
or App Store compliance. Record those results against exact deployed revisions.
