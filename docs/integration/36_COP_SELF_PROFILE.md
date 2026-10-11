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
- SDK required scripts/check.sh pass:30appunit,5appUI,114packageXCTest(1skip),2SwiftTesting,2accessibilityaudits. Three added tests verify issuer/subject/revision binding, PKCE login hint and real image GPS metadata removal. Source is still being packaged for a clean public pin.
- Physical signed-in login/registration, avatar roundtrip and account switching require joint device acceptance; synthetic tests and builds do not establish it. Actual public IdP login page (login.zeleznalady.cz/realms/cop, existing csm-mobile client and csm redirect) returned200 and offered its registration link on2026-10-05. No registration/login was performed; the SDK exposes that existing page only.

## Deployment

Pending governed API-only release; no changes to web analytics, service secrets, ports, network segmentation, measurement flags or chat provider are part of this release. Runtime evidence and public SDK/source pins will be appended after delivery.
