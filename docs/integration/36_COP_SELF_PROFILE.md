# COP self profile and Jízda „Já“

## Contract and ownership

The sole identity authority is the verified COP OIDC session. User-entered email is only a validated, transient `login_hint`, never an account identifier. Bind host „Já“ to issuer + subjectId + SDK sessionScope + existing Passenger.cloudID; require explicit rebinding after an account change. The host requires an existing passenger marked „Já“ before opening login. Authentication does not enable GPS sharing or create another passenger.

Canonical avatar: existing `cop_user_profiles.preferences.operatorProfile.avatarDataUrl`. No second profile database, no Matrix credentials exposed to the host. COP peer conversations already use this avatar projection; Matrix avatar caches are not synchronously rewritten by these endpoints.

Binding JSON: `openapi/openapi.json`, `COPAccountProfile`, GET `/api/v1/me/profile`, PATCH `/api/v1/me/profile/avatar`. GET is read-only and returns verified issuer/subject/displayName/email/emailVerified, nullable avatar/updatedAt, revision64hex, serverTimestamp. Both routes use the authoritative profile store, no degraded in-memory fallback, no dependency on mobility flags/Dispatch lease. A503 is temporary unavailability, not invalid identity.

PATCH accepts only `avatarDataUrl` and requires a quoted strong `If-Match` revision. Null removes. Server fully decodes PNG/JPEG≤180000bytes,≤1024px per side,one frame, then encodes metadata-free PNG≤512px and180000bytes. No SVG, URL fetch or user-selected owner. Preserve other operator preferences and alerts atomically.428 missing revision;412 changed profile: reload and ask for explicit confirmation; no automatic overwrite.400 invalid image/body/revision;413 transport bound245000bytes. Responses no-store. Existing preferences PUT remains compatible and does not acquire this new precondition requirement; older full-profile clients can still overwrite their own preferences and avatar. Do not claim all historical writers use optimistic concurrency.

## Shared SDK

- `mobilitySignIn(loginHint: String? = nil, switchAccount: Bool = false)` retains PKCE,state,nonce and expected-account guards. Hint validated≤254UTF8bytes,no controls/whitespace,nonempty email parts. Never persist/log it. Different-account selection is explicit and isolated; same-account login refreshes the communication bootstrap as well as COP credential state. Temporary COP/mobility outage does not trigger sign-out.
- `copAccountProfile(expectedScope:) -> CSMCOPAccountProfile`.
- `copAccountAvatarSave(imageData:expectedRevision:expectedScope:)` / `copAccountAvatarRemove(expectedRevision:expectedScope:)` return the updated profile.
- Profile fields: subjectId,issuer,displayName,email,emailVerified,avatarDataUrl,computed avatarData,revision,updatedAt,serverTimestamp,contractVersion. No mobility account UUID is manufactured from email.
- Explicitly chosen image input≤10MiB,≤50Mpix,one frame. Thumbnail/encode runs outside main actor,≤512px JPEG≤180000bytes,without copying source GPS/EXIF. Check cancellation, session generation and expected scope again before PATCH; authenticated transport rechecks before and after network response and rejects redirects. Legacy PNG/JPEG/WebP read≤250000characters remains compatible.
- `CSMCommunicationHost(onAuthenticationRequested:)` optional callback with `.signIn` / `.switchAccount` routes sign-in/account mismatch to the host profile. Nil preserves existing embedded behavior. Device unlock,E2EE and ready communication remain owned by SDK.

No avatar upload for other passengers; no automatic upload of their photos. Access token remains SDK-only. Host must explicitly confirm save/remove and conflict retry. No real user account, login or avatar was altered for automated tests.

## Verification (2026-10-05)

- Six isolated route/image tests pass: auth/no-store/read-only, two owners, metadata removal, preserve preferences/alerts, concurrent update/remove, invalid identity/body/image/revision, authoritative-store outage.
- Real isolated PostgreSQL test passes: separate connections create/update serialization, stale cross-owner revision, rollback of rejected first write, preserved preferences/alerts and restart persistence.
- COP regression1296pass/4skip (optional isolated DB tests skipped unless their dedicated env is set); lint/typecheck/API build pass.
- SDK required scripts/check.sh pass:30appunit,5appUI,114packageXCTest(1skip),2SwiftTesting,2accessibilityaudits. Three added tests verify issuer/subject/revision binding, PKCE login hint and real image GPS metadata removal. Clean public SDK snapshot c0ae543 also passes5targetedprofile/OIDCtests; the package compiles without unrelated unpublished sources.
- Physical signed-in login/registration, avatar roundtrip and account switching require joint device acceptance; synthetic tests and builds do not establish it. Actual public IdP login page (login.zeleznalady.cz/realms/cop, existing csm-mobile client and csm redirect) returned200 and offered its registration link on2026-10-05. No registration/login was performed; the SDK exposes that existing page only.

## Deployment

Deployed COP API-only2026-10-05T14:41:20.186864193Z.

- Source1186074e8804c0729bc436cd64553cfa36ccf2af (codex/cop-self-profile), image sha256:7e28ae4186b1a7d303229eb4c81e49ab5b6e9b66f13c827394aa2a9aeab5e35e, healthy/ready200. Server checkout is unchanged; versioned image overlay holds these exact compiled sources.
- Public SDK c0ae543ff45723ef4fbfb3f72010e58c9afa9c47 (codex/shared-mobility-sdk), source/SDK handoff sent to Jízda. Local unrelated China/routing/measurement work is not part of this pin.
- Isolated image with networknone:415artifact hashes, real native Linux codec/sanitization and synthetic owner/revision boundary pass.415hashes rechecked in the running container.
- Runtime2026-10-05T14:42:56.616Z: health live/ready/dependencies200, anonymous GETprofile and PATCHavatar401, four existing mobilityroutes401, primaryDB and exactly one dedicated Dispatch lease. Measurementsfalse/sharedMobilitytrue/Dispatchtrue preserved.
- Preflight/postdeploy environment, command/healthcheck/resources/mounts/networks/security/compose/secrets hashes unchanged; other134container identities unchanged. No public port, network, web, analytics, AI/provider or user data change.
- Rollback retains previous invitation image sha256:3e860fb34dc68426f3dbc33bf24149f0c6ed8346fe1ff08116b0f4fec9467b19 as delta-acr-cop-api:self-profile-rollback-20261005. Retag oldimage to delta-acr-cop-api:local and recreate onlycop-api with the same existing composefiles; verify health/Dispatch. Existing profile data/schema remain compatible. This rollback command was prepared, not exercised in production for the profile release.
- Host evidence directory /home/voldzi/cop-deployments/cop-self-profile-20261005: manifest, image-build, before/after deployment, runtime-check, versioned deploy script. No credentials or photographs in evidence.

Authenticated real account/avatar roundtrip and Jízda physical-phone/UI acceptance remain unverified; this release does not claim them.

Binding full OpenAPI SHA256 at release: `609a285243e2d56a3075dba1561d7765ffda83f81ae0c0c68405601094212efd`.

Post-restart stability recheck2026-10-05T14:47:03.100Z (5m43s after start): all three health endpoints200, profileGET/avatarPATCH401 without auth, fourmobilityroutes401, primaryDB andone dedicatedDispatchlease unchanged, existing featureflags unchanged. SDK documentation-only delivery23940b9; implementationpin remainsc0ae543. COP Chroma reindex697files/15indexed/682skipped/1191chunks/1158deleted completed.
