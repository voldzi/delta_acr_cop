/** Separate bounded actual JWT validation probe; no room or media connection. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { AccessToken, RoomServiceClient } = createRequire("/app/apps/cop-api/package.json")("livekit-server-sdk");
const privateConfig = JSON.parse(readFileSync("/dev/shm/cop-livekit-whole.json", "utf8"));
assert(privateConfig.apiKey && privateConfig.apiSecret);
const endpoint = "http://127.0.0.1:7880", client = new RoomServiceClient(endpoint, privateConfig.apiKey, privateConfig.apiSecret, { requestTimeout: 5, failover: false });
const beforeRooms = (await client.listRooms()).map(room => room.name).sort();
const grant = new AccessToken(privateConfig.apiKey, privateConfig.apiSecret, { identity: "synthetic-expiry-validation-only", ttl: 4 });
grant.addGrant({ roomJoin: true, room: "synthetic-expiry-validation-only", canPublish: false, canSubscribe: false, canPublishData: false });
const jwt = await grant.toJwt(), claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
assert.equal(claims.sub, "synthetic-expiry-validation-only"); assert.equal(claims.video.roomJoin, true);
assert.equal(claims.video.canPublish, false); assert.equal(claims.video.canSubscribe, false);
assert(Number.isSafeInteger(claims.exp) && claims.exp * 1000 > Date.now());
const validate = async () => {
  const response = await fetch(endpoint + "/rtc/validate?" + new URLSearchParams({ access_token: jwt }), { signal: AbortSignal.timeout(5000), redirect: "error" });
  const status = response.status; await response.body?.cancel(); return status;
};
const validStatus = await validate(); assert.equal(validStatus, 200, "LIVEKIT_BEFORE_EXPIRY_HTTP_" + validStatus);
// Real elapsed wall time; the provider's clock and JWT timestamps are unmodified.
await new Promise(resolve => setTimeout(resolve, Math.max(0, claims.exp * 1000 + 1100 - Date.now())));
let expiredStatus = await validate(); const firstAfterNominalExpiryHttp = expiredStatus;
const deadline = claims.exp * 1000 + 120000;
while (expiredStatus === 200 && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 1000)); expiredStatus = await validate();
}
assert.equal(expiredStatus, 401, "LIVEKIT_AFTER_EXPIRY_HTTP_" + expiredStatus);
const secondsAfterNominalExpiry = (Date.now() - claims.exp * 1000) / 1000;
assert.deepEqual((await client.listRooms()).map(room => room.name).sort(), beforeRooms);
process.stdout.write(JSON.stringify({ contractVersion: "cop-livekit-join-jwt-expiry-probe-v1", actualProviderValidation: true,
  actualSdkJoinGrant: true, beforeExpiryHttp: validStatus, firstAfterNominalExpiryHttp, afterActualExpiryHttp: expiredStatus, secondsAfterNominalExpiry, configuredTtlSeconds: 4,
  realWallClockWait: true, roomsUnchanged: true, mediaConnected: false, participantsConnected: false, credentialsPrinted: false, productionChanged: false }) + "\n");
