# Conversation-scoped identity lookup — 9 November 2026

Production Messaging b859 did not implement the lookup route already called by COP. Its framework404 was incorrectly passed through as a missing conversation. Provisioning `/resolve` is not a safe substitute.

Messaging d751247 adds service-authenticated, explicit-actor, issuer-bound read-only lookup. It checks the original CommunicationUsageGuard mapping and current conversation/fences before and after reading; unknown provenance fails closed. Managed conversations require a ready bound room. It never provisions identities, logs in, joins or sends. COP preserves403/404 only for the exact typed error bound to actor/conversation; absent routes, WAF and malformed errors become503. Public COP response shape is unchanged.

[Verification receipt](verification.json) separates fresh fixtures, actual original-gate PostgreSQL tests, local prod compilation and later image/phone acceptance. Messaging source includes its own detailed test receipt and the successful isolated compiled-out authority proof. Jízda independently reviewed all five runtime hashes and replayed9 bridge/provider and2 native PostgreSQL cases.

Roll out Messaging first, then COP via its application release broker. Preserve env, mounts, roles, account data, device keys, networks and schema; source and image must match the freshly read baselines. Immediate preceding images are schema-compatible returns for this lookup-only change. Existing managed room fences still apply; do not replace with pre-enrollment images. No direct owner lookup probe is authorized; the phone owner performs it. No claimed join/delivery or Matrix401 repair without owner acceptance.
