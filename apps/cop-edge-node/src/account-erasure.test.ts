import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeRuntime, handleRequest, readEdgeConfig } from "./index.js";
const realFetch = globalThis.fetch;
import { edgeResourcesDigest, type EdgeErasureRequest } from "./account-erasure.js";

const ownId = "137cb1d9-5da3-4b1a-8de2-fd37401dfe87", otherId = "237cb1d9-5da3-4b1a-8de2-fd37401dfe87";
const subject = "337cb1d9-5da3-4b1a-8de2-fd37401dfe87";
const input = (): EdgeErasureRequest => ({ contractVersion: "cop-edge-account-erasure-v1", phase: "erase", scope: "full_account", accountKey: "a".repeat(64), operationId: "437cb1d9-5da3-4b1a-8de2-fd37401dfe87",
  actor: { issuer: "https://identity.synthetic.test/realms/cop", subjectId: subject }, datasetBinding: { incarnationId: "537cb1d9-5da3-4b1a-8de2-fd37401dfe87", restoreGeneration: 1 },
  resources: { reportIds: [ownId], groupIds: [], incidentIds: [], taskIds: [], drawingIds: [] } });
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(items: Record<string, unknown>[] = []) {
  const dataDir = await mkdtemp(join(tmpdir(), "cop-edge-erasure-owned-")); directories.push(dataDir);
  const config = readEdgeConfig({ COP_EDGE_DATA_DIR: dataDir, COP_EDGE_AUTO_SYNC: "false", COP_EDGE_CENTRAL_API_URL: "https://central.synthetic.test", COP_EDGE_CENTRAL_TOKEN: "synthetic-only", COP_EDGE_NODE_ID: "synthetic-edge", COP_EDGE_ADMIN_TOKEN: "synthetic-edge-admin" });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/edge/replay/") ? { items, nextOffset: items.length } : { items: [] })));
  const runtime = await EdgeRuntime.create(config); return { runtime, config, dataDir };
}
const event = (entityId: string, title: string, id = randomUUID()) => ({ id, entityType: "communityReport", entityId, producerNodeId: "node_central_cop", source: "urn:csm:node:node_central_cop", payload: { reportId: entityId, title }, replayOffset: 1 });

describe("actual edge durable cache and outbox account erasure", () => {
  it("deletes verified central A cache refs with durable proof and preserves B cache and outbox", async () => {
    const { runtime, dataDir } = await fixture([event(ownId,"SYNTHETIC_A_PRIVATE"),event(otherId,"SYNTHETIC_B_PRESERVED")]);
    await runtime.syncOnce();
    await runtime.queueOutboxEvent({ entityType:"communityReport", entityId:otherId,payload:{reportId:otherId,title:"SYNTHETIC_B_OUTBOX"} });
    expect(await runtime.eraseAccount({...input(),phase:"preflight"})).toMatchObject({state:"ready"});
    const proof = await runtime.eraseAccount(input()); expect(proof).toMatchObject({state:"completed",resourcesDigest:edgeResourcesDigest(input().resources)}); expect(proof.proofId).toMatch(/^[a-f0-9]{64}$/u);
    expect(await runtime.eraseAccount(input())).toEqual(proof);
    const file=await readFile(join(dataDir,"state.json"),"utf8"); expect(file).not.toContain("SYNTHETIC_A_"); expect(file).toContain("SYNTHETIC_B_PRESERVED"); expect(file).toContain("SYNTHETIC_B_OUTBOX");
    const journal=JSON.stringify(JSON.parse(file).accountErasure); expect(journal).not.toContain(subject); expect(journal).not.toContain(input().actor.issuer);
    expect(await runtime.accountErasureCapabilities()).toEqual({contractVersion:"cop-edge-account-erasure-v1",nodeId:"synthetic-edge",writerFenceInstalled:true,stateReadbackVerified:true});
  });
  it("waits an actual outstanding replay before erasing and blocks later known replay and outbox admission", async () => {
    const {runtime}=await fixture(); let entered!:()=>void, release!:(value:Response)=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}); const waiting=new Promise<Response>(resolve=>{release=resolve;});
    vi.stubGlobal("fetch", vi.fn(async (url:string)=>{ if(url.includes("/edge/replay/")){entered();return waiting;} return Response.json({items:[]}); }));
    const syncing=runtime.syncOnce(); await started; let complete=false; const erasing=runtime.eraseAccount(input()).then(v=>{complete=true;return v;});
    await new Promise(resolve=>setTimeout(resolve,30)); expect(complete).toBe(false);
    release(Response.json({items:[event(ownId,"SYNTHETIC_LATE_ADMITTED_A"),event(otherId,"SYNTHETIC_B")],nextOffset:2}));
    await syncing; expect(await erasing).toMatchObject({state:"completed"}); expect(JSON.stringify(runtime.getPublicState())).not.toContain("SYNTHETIC_LATE_ADMITTED_A");
    await expect(runtime.queueOutboxEvent({entityType:"communityReport",entityId:ownId,payload:{reportId:ownId}})).rejects.toMatchObject({status:403});
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>Response.json(url.includes("/edge/replay/")?{items:[event(ownId,"SYNTHETIC_REPLAY_AFTER_ERASE")],nextOffset:3}:{items:[]})));
    await runtime.syncOnce(); expect(JSON.stringify(runtime.getPublicState())).not.toContain("SYNTHETIC_REPLAY_AFTER_ERASE");
  });
  it("never treats a local-edge outbox or forged source as verified central ownership", async () => {
    const forged={...event(ownId,"SYNTHETIC_UNTRUSTED_SOURCE"),source:"urn:untrusted:origin"};
    const {runtime,dataDir}=await fixture([forged]); await runtime.syncOnce();
    await runtime.queueOutboxEvent({entityType:"communityReport",entityId:ownId,payload:{reportId:ownId,title:"SYNTHETIC_LOCAL_OUTBOX"}});
    expect(await runtime.eraseAccount(input())).toMatchObject({state:"pending",reason:"ownership_unresolved"});
    const file=await readFile(join(dataDir,"state.json"),"utf8"); expect(file).toContain("SYNTHETIC_UNTRUSTED_SOURCE"); expect(file).toContain("SYNTHETIC_LOCAL_OUTBOX");
    await expect(runtime.eraseAccount({...input(),resources:{...input().resources,reportIds:["not-a-verified-uuid"]}})).rejects.toMatchObject({status:400});
  });
  it("keeps unknown actor-only metadata pending and does not delete another user's unmatched row", async()=>{
    const {runtime,dataDir}=await fixture([{id:randomUUID(),entityType:"auditRecord",entityId:"unverified-reference",payload:{subjectId:subject,text:"SYNTHETIC_UNKNOWN_OWNER"}},event(otherId,"SYNTHETIC_B")]);
    await runtime.syncOnce(); expect(await runtime.eraseAccount({...input(),phase:"preflight"})).toMatchObject({state:"pending",reason:"ownership_unresolved"});
    expect(await runtime.eraseAccount(input())).toMatchObject({state:"pending",reason:"ownership_unresolved"});
    const state=await readFile(join(dataDir,"state.json"),"utf8"); expect(state).toContain("SYNTHETIC_UNKNOWN_OWNER"); expect(state).toContain("SYNTHETIC_B"); expect(JSON.parse(state).accountErasure.fences[0].proofId).toBeUndefined();
  });
  it("persists fencing across restart, rejects stolen/rewound identities, and refreshes completion only in a newer incarnation",async()=>{
    const {runtime,config}=await fixture([event(ownId,"SYNTHETIC_A")]); await runtime.syncOnce(); const first=await runtime.eraseAccount(input());
    const restarted=await EdgeRuntime.create(config); expect(await restarted.eraseAccount(input())).toEqual(first);
    await expect(restarted.eraseAccount({...input(),operationId:randomUUID()})).rejects.toMatchObject({status:409});
    await expect(restarted.eraseAccount({...input(),actor:{...input().actor,subjectId:"synthetic-other"}})).rejects.toMatchObject({status:409});
    await expect(restarted.eraseAccount({...input(),datasetBinding:{...input().datasetBinding,incarnationId:randomUUID()}})).rejects.toMatchObject({status:409});
    const next={...input(),datasetBinding:{incarnationId:randomUUID(),restoreGeneration:2}}; const second=await restarted.eraseAccount(next); expect(second).toMatchObject({state:"completed"}); expect(second.proofId).not.toBe(first.proofId);
    await expect(restarted.eraseAccount(input())).rejects.toMatchObject({status:409});
  });
  it("preserves B nested references as unknown instead of using them as deletion ownership", async () => {
    const referenced={...event(otherId,"SYNTHETIC_B_REFERS_TO_A"),payload:{reportId:otherId,related:{reportId:ownId},title:"SYNTHETIC_B_REFERS_TO_A"}};
    const {runtime,dataDir}=await fixture([event(ownId,"SYNTHETIC_A_CENTRAL"),referenced]); await runtime.syncOnce();
    const result=await runtime.eraseAccount(input()); expect(result).toMatchObject({state:"pending",reason:"ownership_unresolved"});
    const file=await readFile(join(dataDir,"state.json"),"utf8"); expect(file).not.toContain("SYNTHETIC_A_CENTRAL"); expect(file).toContain("SYNTHETIC_B_REFERS_TO_A");
  });
  it("unions report and drawing manifests of one operation and validates the persisted union digest", async () => {
    const drawingId="637cb1d9-5da3-4b1a-8de2-fd37401dfe87";
    const drawing={...event(drawingId,"SYNTHETIC_A_DRAWING"),entityType:"sketchDrawing",subject};
    const {runtime,config,dataDir}=await fixture([event(ownId,"SYNTHETIC_A_REPORT"),drawing]); await runtime.syncOnce();
    expect(await runtime.eraseAccount(input())).toMatchObject({state:"pending"});
    const drawingRequest={...input(),resources:{reportIds:[],groupIds:[],incidentIds:[],taskIds:[],drawingIds:[drawingId]}};
    expect(await runtime.eraseAccount(drawingRequest)).toMatchObject({state:"completed",resourcesDigest:edgeResourcesDigest(drawingRequest.resources)});
    expect(await runtime.eraseAccount(input())).toMatchObject({state:"completed",resourcesDigest:edgeResourcesDigest(input().resources)});
    const state=JSON.parse(await readFile(join(dataDir,"state.json"),"utf8"));
    expect(state.accountErasure.fences[0].resources.reportIds).toEqual([ownId]); expect(state.accountErasure.fences[0].resources.drawingIds).toEqual([drawingId]);
    expect(state.accountErasure.fences[0].resourcesDigest).toBe(edgeResourcesDigest(state.accountErasure.fences[0].resources));
    state.accountErasure.fences[0].resourcesDigest="f".repeat(64); await writeFile(join(dataDir,"state.json"),JSON.stringify(state));
    await expect(EdgeRuntime.create(config)).rejects.toMatchObject({code:"EDGE_STATE_FILE_INVALID"});
  });
  it("requires real current disk readback and never resets malformed or missing accepted state to empty",async()=>{
    const {runtime,config,dataDir}=await fixture(); await runtime.eraseAccount(input()); const state=await readFile(join(dataDir,"state.json"),"utf8");
    await writeFile(join(dataDir,"state.json"),"{broken synthetic state"); await expect(runtime.accountErasureCapabilities()).rejects.toBeDefined();
    await expect(EdgeRuntime.create(config)).rejects.toMatchObject({code:"EDGE_STATE_FILE_INVALID"});
    await writeFile(join(dataDir,"state.json"),state); await unlink(join(dataDir,"state.json"));
    await expect(EdgeRuntime.create(config)).rejects.toMatchObject({code:"EDGE_ERASURE_STATE_MISSING"});
  });
  it("rejects extra context and removes only known obsolete state temp snapshots after current state readback",async()=>{
    const {runtime,dataDir}=await fixture(); await expect(runtime.eraseAccount({...input(),freeContext:"forbidden"})).rejects.toMatchObject({status:400});
    await writeFile(join(dataDir,"state.json.123.1790000000000.tmp"),"SYNTHETIC_ABANDONED_SNAPSHOT");
    await writeFile(join(dataDir,"unrelated.txt"),"SYNTHETIC_OPERATOR_FILE");
    expect(await runtime.eraseAccount(input())).toMatchObject({state:"completed"});
    await expect(readFile(join(dataDir,"state.json.123.1790000000000.tmp"))).rejects.toMatchObject({code:"ENOENT"});
    expect(await readFile(join(dataDir,"unrelated.txt"),"utf8")).toBe("SYNTHETIC_OPERATOR_FILE");
  });
  it("authenticates the actual HTTP routes and returns only strict receipt or generic correlated errors", async () => {
    const { runtime, config } = await fixture();
    const server = createServer((request,response)=>{ void handleRequest(config,runtime,request,response); });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const endpoint=`http://127.0.0.1:${(server.address() as AddressInfo).port}/edge/internal/account-erasure`;
    const send=(body:unknown)=>realFetch(endpoint,{method:"POST",headers:{authorization:"Bearer synthetic-edge-admin","content-type":"application/json"},body:JSON.stringify(body)});
    try {
      const denied=await realFetch(endpoint+"/capabilities"); expect(denied.status).toBe(401); expect(await denied.json()).toMatchObject({error:{code:"UNAUTHORIZED",correlationId:expect.stringMatching(/^[a-f0-9-]{36}$/u)}});
      const caps=await realFetch(endpoint+"/capabilities",{headers:{authorization:"Bearer synthetic-edge-admin"}}); expect(caps.status).toBe(200); expect(await caps.json()).toEqual({contractVersion:"cop-edge-account-erasure-v1",nodeId:"synthetic-edge",writerFenceInstalled:true,stateReadbackVerified:true});
      const invalid=await send({...input(),privateContext:"SYNTHETIC_FORBIDDEN"}); expect(invalid.status).toBe(400); const failure=await invalid.text(); expect(failure).toContain("correlationId"); expect(failure).not.toContain("SYNTHETIC_FORBIDDEN");
      const oversized=await send({...input(),privateContext:"x".repeat(1048576)}); expect(oversized.status).toBe(400); await oversized.body?.cancel();
      const preflight=await send({...input(),phase:"preflight"}); expect(preflight.status).toBe(200); expect(await preflight.json()).toMatchObject({state:"ready"});
      const completed=await send(input()); expect(completed.status).toBe(200); expect(await completed.json()).toMatchObject({state:"completed",proofId:expect.stringMatching(/^[a-f0-9]{64}$/u)});
      const conflict=await send({...input(),operationId:randomUUID()}); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({error:{code:"EDGE_ERASURE_IDENTITY_OR_OPERATION_CONFLICT",correlationId:expect.any(String)}});
    } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
  });
  it("rejects a malformed persisted cache row rather than acknowledging an unexamined raw copy", async () => {
    const {runtime,config,dataDir}=await fixture(); await runtime.accountErasureCapabilities();
    const state=JSON.parse(await readFile(join(dataDir,"state.json"),"utf8")); state.inboundEvents.push("SYNTHETIC_MALFORMED_RAW_COPY");
    await writeFile(join(dataDir,"state.json"),JSON.stringify(state)); await expect(EdgeRuntime.create(config)).rejects.toMatchObject({code:"EDGE_STATE_FILE_INVALID"});
  });
  it("normalizes uppercase duplicate resource IDs to the exact agreed canonical digest", () => {
    const resources={...input().resources,reportIds:[ownId.toUpperCase(),ownId]};
    expect(edgeResourcesDigest(resources)).toBe(edgeResourcesDigest(input().resources));
  });
  it("computes the currently accepted exact ordered digest without user content or key selection",()=>{
    const resources={reportIds:[ownId,ownId],groupIds:[],incidentIds:[],taskIds:[],drawingIds:[]};
    expect(edgeResourcesDigest(resources)).toBe(createHash("sha256").update(JSON.stringify(input().resources)).digest("hex"));
  });
});
