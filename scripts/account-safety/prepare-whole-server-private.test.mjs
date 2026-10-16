import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createSyntheticCredentialMaterial, preparePrivateKeycloakSeedSource, serverPrivateActorReferences } from "./prepare-whole-server-private.mjs";
test("synthetic credentials are fresh, independent and never a production value",()=>{const a=createSyntheticCredentialMaterial(),b=createSyntheticCredentialMaterial();const keys=Object.keys(a).filter(x=>x!=="contractVersion");assert.equal(new Set(keys.map(k=>a[k])).size,keys.length);for(const key of keys){assert.equal(typeof a[key],"string");assert.ok(a[key].length>=43);assert.notEqual(a[key],b[key]);}assert.equal(Buffer.from(a.root,"base64").length,32);assert.equal(Buffer.from(a.routerEncryptionKey,"base64").length,32);});
test("real existing KC seed becomes private-file-only source with exact boundaries",()=>{const source=readFileSync(new URL("../keycloak/erasure-provider-probe.mjs",import.meta.url),"utf8"),seed=preparePrivateKeycloakSeedSource(source);assert.match(seed,/privateFixture.adminPassword/u);assert.match(seed,/privateFixture.userPassword/u);assert.match(seed,/writeFileSync\('/u);assert.ok(!seed.includes("console.log"));assert.ok(!seed.includes("synthetic-bootstrap-not-production"));assert.ok(!seed.includes("synthetic-user-not-production"));assert.match(seed,/actualSeedChecks:checks/u);});
test("changed source or unreviewed output cannot silently run",()=>{const source=readFileSync(new URL("../keycloak/erasure-provider-probe.mjs",import.meta.url),"utf8");assert.throws(()=>preparePrivateKeycloakSeedSource(source.replace("const calls = [];","const changed=[];")));assert.throws(()=>preparePrivateKeycloakSeedSource(source.replace("const calls = [];","console.log('unexpected');const calls = [];")));});

const actualSeedShape = () => ({ contractVersion: "cop-whole-server-keycloak-private-v2", actors: Object.fromEntries(["a","b","c","d"].map((key,index) => [key,{subjectId:`10000000-0000-4000-8000-00000000000${index+1}`,password:"private-synthetic-password",cop:{access_token:"private-synthetic-token"}}])),
 actualSeedProof:{signedActorCount:4,signedClientTokenCount:12,clientIds:["cop-web","csm-mobile","csm-sim-web"],signatureAndUserinfoVerified:true} });
test("new server fixture references retain A/B and expose only two exact additional roles, no credentials",()=>{
 const seed=actualSeedShape(),references=serverPrivateActorReferences(seed);
 assert.deepEqual(references,{subjects:{a:seed.actors.a.subjectId,b:seed.actors.b.subjectId},additionalActors:{c:{subjectId:seed.actors.c.subjectId,role:"novice"},d:{subjectId:seed.actors.d.subjectId,role:"peer"}},actorCount:4});
 assert.doesNotMatch(JSON.stringify(references),/password|access_token|synthetic/u);
});
test("four-real-actor references reject incomplete, duplicate, unverified or arbitrary additional users",()=>{
 const cases=[seed=>delete seed.actors.d,seed=>seed.actors.d.subjectId=seed.actors.c.subjectId,seed=>seed.actors.e={subjectId:"20000000-0000-4000-8000-000000000001"},seed=>seed.actualSeedProof.signatureAndUserinfoVerified=false,seed=>seed.actualSeedProof.signedClientTokenCount=2,seed=>seed.actualSeedProof.clientIds=["unreviewed-client"],seed=>seed.contractVersion="cop-whole-server-keycloak-private-v1"];
 for(const mutate of cases){const seed=actualSeedShape();mutate(seed);assert.throws(()=>serverPrivateActorReferences(seed),/FOUR_ACTUAL_KEYCLOAK_ACTORS_UNPROVEN/u);}
});
test("rendered new seed creates actual C/D through the same real KC API and verifies every client token signature",()=>{
 const original=readFileSync(new URL("../keycloak/erasure-provider-probe.mjs",import.meta.url),"utf8"),seed=preparePrivateKeycloakSeedSource(original);
 assert.match(seed,/c = await user\('fixture-novice-c'\), d = await user\('fixture-peer-d'\)/u);
 assert.match(seed,/for \(const owner of \[a, b, c, d\]\) for \(const id of Object.keys\(clients\)\)/u);
 for(const proof of ["verifySignature('RSA-SHA256'","assert.equal(claims.azp,clientId)","assert.equal(info.value.sub,owner.id)","assert.equal(actualClient.publicClient,true)","assert.equal(signedClientTokenCount,12)"]) assert(seed.includes(proof));
 assert(!seed.includes("Matrix"));assert(!seed.includes("console."));
 const parsed=spawnSync(process.execPath,["--input-type=module","--check"],{input:seed,encoding:"utf8"});assert.equal(parsed.status,0,parsed.stderr);
 // The shared old source retains its two-user behavior and is never edited.
 assert(original.includes("const a = await user('fixture-owner-a'), b = await user('fixture-owner-b');"));assert(!original.includes("fixture-novice-c"));
});
