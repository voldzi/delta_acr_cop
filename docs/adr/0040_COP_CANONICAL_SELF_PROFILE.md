# ADR0040: canonical self profile for embedded COP hosts

Accepted2026-10-05 for the human-approved Jízda „Já“ integration.

Use verified OIDC issuer/subject as identity, validated email only as transient login hint. Reuse the COP persisted operatorProfile avatar. Add authenticated read-only profile and avatar-only atomic If-Match endpoint; fail503 on authoritative-store failure rather than accepting a temporary fallback write. Do not tie profile/authentication to mobility availability. Keep Matrix/E2EE and tokens inside SDK. Hosts control the sole login entry via an optional callback, preserving existing clients.

New avatar writes are bounded decoded rasters re-encoded without metadata on client and server. Existing full-preferences endpoint remains compatible; its legacy writes have no new CAS guarantee. Real device and IdP acceptance remain distinct from build/test evidence.

Contract and acceptance: [36_COP_SELF_PROFILE](../integration/36_COP_SELF_PROFILE.md).
