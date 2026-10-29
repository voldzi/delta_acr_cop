# ADR 0058: Explicit assisted planning origin

Status: accepted source contract; production and device acceptance separate.

An inaccurate phone sample or an off-road position must not cause hidden GPS
replacement, wider route snapping, destination-only exemptions or acceptance of
Valhalla restriction-relaxation warnings. Manual selection alone did not establish
that the original indoor routing failure was resolved.

Add two separate authenticated operations for nearby graph candidates and an
explicitly confirmed planning preview. Discovery uses one locate query within
500 m, independently of measurement accuracy, and returns at most three choices.
Candidates have unverified legal access, dimensions and direction. Opposite
directed edges remain distinguishable. Candidate IDs are stateless UX correlation,
not attested issuance, access rights or provider options.

Every selected point undergoes the existing full mapped-profile, 25 m snap,
reviewed-closure, engine-warning and dataset checks. The response carries a distinct
planning assessment and preview path, full mapped facts and actual closure evidence.
COP independently reuses the existing proof semantics. No ordinary assessment is
exposed or promoted into navigation. Departure requires fresh ordinary routing;
independent GPS recording remains available.

COP derives a stable pseudonymous actor from its verified OIDC request identity.
Only an explicitly allowed existing SIM geo service principal may assert this
actor. There is no new signing key, AI/erasure key reuse or browser-selected actor.
Request hashes bind the actor on COP/SIM; SDK checks public context/geometry hashes
and its current account epoch over authenticated COP transport. Hashes are integrity
bindings, not cryptographic access credentials.

The new feature defaults off in COP and deny in SIM. It has no result cache,
single-flight sharing, automatic retry or provider fallback. Production credential
provisioning stays within production secret files. Existing API operations remain
unchanged. See [contract and acceptance](../integration/27_JIZDA_MAPPED_VEHICLE_PROFILES.md).
