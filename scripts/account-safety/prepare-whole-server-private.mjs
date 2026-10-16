/** New isolated whole fixture only. Private material never leaves server tmpfs.
 * The coordinator must first verify the exact owned container/image/namespace.
 * This helper does not create containers or operate an existing erasure case. */
import { constants, fstatSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
const ROOT = "/dev/shm/cop-whole", credentialPath = ROOT + "/server-fixture-credentials.json";
const need = (value, code) => { if (!value) throw Error(code); };
export function createSyntheticCredentialMaterial() {
  const secret = () => randomBytes(32).toString("base64url");
  return { contractVersion: "cop-whole-server-private-credentials-v1", adminPassword: secret(), userPassword: secret(), workerSecret: secret(),
    provisionSecret: secret(), root: randomBytes(32).toString("base64"), copServiceToken: secret(), routerHashSecret: secret(),
    routerSimToken: secret(), routerAdminToken: secret(), routerEncryptionKey: randomBytes(32).toString("base64") };
}
function directory() {
  const st = lstatSync(ROOT);
  need(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o777) === 0o700 &&
    realpathSync(ROOT) === ROOT && Number(statfsSync(ROOT).type) === 0x01021994, "WHOLE_PRIVATE_OWNED_TMPFS_REQUIRED");
}
function readPrivate(path) {
  directory(); need(path.startsWith(ROOT + "/") && !path.includes("/../"), "WHOLE_PRIVATE_PATH_REJECTED");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const st = fstatSync(fd); need(st.isFile() && st.nlink === 1 && st.uid === process.getuid() && (st.mode & 0o777) === 0o600 && st.size <= 2_000_000,
    "WHOLE_PRIVATE_FILE_CUSTODY_REJECTED"); return JSON.parse(readFileSync(fd, "utf8")); } finally { closeSync(fd); }
}
function writePrivate(path, value) {
  directory(); need(path.startsWith(ROOT + "/") && !path.includes("/../"), "WHOLE_PRIVATE_PATH_REJECTED");
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, typeof value === "string" ? value : JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
}
export function preparePrivateKeycloakSeedSource(original) {
  const marker = "const calls = [];";
  need(original.split(marker).length === 2, "WHOLE_KC_SEED_BOUNDARY_CHANGED");
  let source = original.split(marker)[0];
  const replace = (before, after, count = 1) => { need(source.split(before).length - 1 === count, "WHOLE_KC_SEED_SOURCE_CHANGED"); source = source.replaceAll(before, after); };
  replace("import { createKeycloakAccountErasureAdapter } from './keycloak-account-erasure.js';\n", "");
  replace("const realm = 'cop-erasure-fixture';", "const realm = 'cop-erasure-whole';");
  replace("const syntheticSecret = 'synthetic-fixture-worker-not-a-production-secret';", "const syntheticSecret = privateFixture.workerSecret;");
  replace("const provisionSecret='synthetic-only-erasure-client-secret-not-production-v1';", "const provisionSecret=privateFixture.provisionSecret;");
  replace("'synthetic-bootstrap-not-production'", "privateFixture.adminPassword");
  replace("'synthetic-user-not-production'", "privateFixture.userPassword", 2);
  replace("publicClient: !worker, standardFlowEnabled", "publicClient: !worker, ...(worker ? {} : { defaultClientScopes: ['basic','profile','email','roles'] }), standardFlowEnabled");
  need(!source.includes("console.log") && !source.includes("console.error"), "WHOLE_KC_SEED_UNEXPECTED_OUTPUT");
  return `import { readFileSync, writeFileSync } from 'node:fs';
const privateFixture=JSON.parse(readFileSync('${credentialPath}','utf8'));
${source}
for(const owner of [a,b]){
 const claims=JSON.parse(Buffer.from(offline[owner.id+'cop-web'].access_token.split('.')[1],'base64url'));
 assert.equal(claims.iss,issuer);assert.equal(claims.sub,owner.id);
 assert.equal((await response('/realms/'+realm+'/protocol/openid-connect/userinfo','GET',undefined,offline[owner.id+'cop-web'].access_token)).value.sub,owner.id);
}
const privateSeed={issuer,realm,actors:{a:{subjectId:a.id,username:a.username,password:privateFixture.userPassword,cop:offline[a.id+'cop-web'],sim:offline[a.id+'csm-sim-web']},b:{subjectId:b.id,username:b.username,password:privateFixture.userPassword,cop:offline[b.id+'cop-web'],sim:offline[b.id+'csm-sim-web']}},erasureClient:{id:ERASURE_CLIENT_ID,secret:provisionSecret,clientUuid:provisioned.clientUuid,serviceUuid:provisioned.serviceUuid},clientUuids:Object.fromEntries(Object.entries(clients).map(([key,value])=>[key,value.id])),actualSeedChecks:checks};
writeFileSync('${ROOT}/keycloak-private.json',JSON.stringify(privateSeed),{mode:384,flag:'wx'});
`;
}
export async function prepareServerPrivateFixture(action, options = {}) {
  directory();
  if (action === "create-credentials") {
    need(typeof options.ownerLabel === "string" && /^cop-erasure-whole-[a-f0-9]{12}$/u.test(options.ownerLabel), "WHOLE_NEW_OWNER_LABEL_REQUIRED");
    const value = { ...createSyntheticCredentialMaterial(), ownerLabel: options.ownerLabel };
    writePrivate(credentialPath, value);
    return { contractVersion: "cop-whole-server-private-reference-v1", ownerLabel: options.ownerLabel, credentialRef: credentialPath,
      serverOnly: true, mode: "0600", created: true, productionChanged: false, wholeAccountAccepted: false };
  }
  const privateFixture = readPrivate(credentialPath);
  need(privateFixture.contractVersion === "cop-whole-server-private-credentials-v1", "WHOLE_PRIVATE_CREDENTIAL_CONTRACT_REJECTED");
  if (action === "seed-keycloak") {
    need(typeof options.seedSource === "string" && typeof options.provisionSource === "string", "WHOLE_REVIEWED_KC_SOURCE_REQUIRED");
    const sourceDir = ROOT + "/keycloak-source"; mkdirSync(sourceDir, { mode: 0o700 });
    writePrivate(sourceDir + "/package.json", { type: "module" });
    writePrivate(sourceDir + "/provision-erasure-client.mjs", options.provisionSource);
    writePrivate(sourceDir + "/seed.mjs", preparePrivateKeycloakSeedSource(options.seedSource));
    await import(pathToFileURL(sourceDir + "/seed.mjs").href);
    const actual = readPrivate(ROOT + "/keycloak-private.json");
    need(actual.issuer === "https://cop-erasure-keycloak.invalid/realms/cop-erasure-whole" && actual.actors.a.subjectId !== actual.actors.b.subjectId &&
      actual.actualSeedChecks.length > 0, "WHOLE_ACTUAL_KEYCLOAK_SEED_NOT_PROVEN");
    return { contractVersion: "cop-whole-server-keycloak-reference-v1", issuer: actual.issuer,
      subjects: { a: actual.actors.a.subjectId, b: actual.actors.b.subjectId }, privateSeedRef: ROOT + "/keycloak-private.json",
      serverOnly: true, actualKeycloakSeedVerified: true, productionChanged: false, wholeAccountAccepted: false };
  }
  if (action === "export-bootstraps") {
    const actual = readPrivate(ROOT + "/keycloak-private.json"), subjects = Object.fromEntries(["a", "b"].map(key => [key, actual.actors[key].subjectId]));
    const { opaqueUserId } = await import(pathToFileURL(ROOT + "/apps/cop-api/dist/ai-router-chat.js").href),
      { contributorIdDay } = await import(pathToFileURL(ROOT + "/apps/cop-api/dist/driver-measurement-contract.js").href);
    const today = new Date().toISOString().slice(0,10), actors = Object.fromEntries(["a", "b"].map(key => [key, {
      subjectId: subjects[key], routerUserId: opaqueUserId(privateFixture.root, subjects[key]),
      contributors: Array.from({ length: 9 }, (_, offset) => { const contributorDay = new Date(Date.parse(today+'T00:00:00.000Z')-offset*86400000).toISOString().slice(0,10);
        return { contributorIdDay: contributorIdDay(privateFixture.root,subjects[key],contributorDay),contributorDay }; }) }]));
    mkdirSync(ROOT + "/bootstrap", { mode: 0o700 });
    const messagingRef = ROOT + "/bootstrap/messaging.json", simRef = ROOT + "/bootstrap/sim.json";
    writePrivate(messagingRef, { contractVersion: "cop-messaging-joint-bootstrap-v1", issuer: actual.issuer, subjects,
      clientIds: ["cop-web","csm-mobile","csm-sim-web"], serviceToken: privateFixture.copServiceToken, root: privateFixture.root });
    writePrivate(simRef, { contractVersion: "cop-sim-whole-erasure-fixture-v1", issuer: actual.issuer, actors,
      environment: { copServiceToken: privateFixture.copServiceToken,driverHashSecret:privateFixture.root,driverActorSecret:privateFixture.root,
        routerHashSecret:privateFixture.routerHashSecret,routerActorSecret:privateFixture.root,routerEncryptionKey:privateFixture.routerEncryptionKey,
        routerSimToken:privateFixture.routerSimToken,routerAdminToken:privateFixture.routerAdminToken } });
    return { contractVersion: "cop-whole-server-bootstrap-references-v1", issuer: actual.issuer, subjects,
      messagingRef, simRef, contributorDaysPerActor: 9, serverOnly: true, productionChanged: false, wholeAccountAccepted: false };
  }
  throw Error("WHOLE_SERVER_PRIVATE_ACTION_REJECTED");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const input = JSON.parse(readFileSync(0, "utf8")); console.log(JSON.stringify(await prepareServerPrivateFixture(input.action, input.options))); }
  catch (error) { console.log(JSON.stringify({ code: /^[A-Z0-9_]{1,100}$/u.test(error.message ?? "") ? error.message : "WHOLE_SERVER_PRIVATE_STEP_FAILED",
    productionChanged: false, wholeAccountAccepted: false })); process.exitCode = 2; }
}
