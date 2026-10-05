import Fastify from "fastify";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { canonicalAvatar, registerCOPAccountProfile } from "./cop-account-profile.js";
import { InMemoryUserProfileStore, userAvatarRevision } from "./user-profile-store.js";
import type { AuthenticatedActor } from "./security.js";

function fixture(store = new InMemoryUserProfileStore(), ready = true) {
  const app = Fastify();
  registerCOPAccountProfile(app, { store, ready: async () => ready, degraded: () => {}, now: () => new Date("2026-10-05T12:00:00Z"), requireActor(request, reply) {
    const subjectId = request.headers.authorization;
    if (!subjectId) { reply.code(401).send({ error: { code: "UNAUTHORIZED" } }); return null; }
    return { subjectId, issuer: "https://synthetic.test/realm", authMode: "oidc", username: subjectId, displayName: "Synthetic", email: "synthetic@example.test", emailVerified: true } as AuthenticatedActor;
  }});
  return { app, store };
}
const headers = (subject = "synthetic-a", revision?: string) => ({ authorization: subject, ...(revision ? { "if-match": '"' + revision + '"' } : {}) });
const image = async () => "data:image/jpeg;base64," + (await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).jpeg().withExif({ IFD0: { Artist: "SYNTHETIC_PRIVATE_METADATA" } }).toBuffer()).toString("base64");

describe("COP self profile boundary", () => {
  it("requires authentication; read is no-store, canonical and never creates a record", async () => {
    const {app,store}=fixture();
    try {
      expect((await app.inject({url:"/api/v1/me/profile"})).statusCode).toBe(401);
      const result=await app.inject({url:"/api/v1/me/profile",headers:headers()});
      expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.json()).toMatchObject({subjectId:"synthetic-a",issuer:"https://synthetic.test/realm",emailVerified:true,avatarDataUrl:null});
      expect(result.headers.etag).toBe('"'+result.json().revision+'"'); expect(await store.getProfile("synthetic-a")).toBeNull();
    } finally {await app.close()}
  });
  it("isolates users, strips metadata and preserves unrelated preferences and alerts", async () => {
    const {app,store}=fixture();
    try {
      const original=await store.upsertProfile({subjectId:"synthetic-a",username:"A",displayName:"A",preferences:{operatorProfile:{phone:"synthetic",organization:"TEST"},theme:"dark"},alertPreferences:{minimumSeverity:"warning"}});
      const result=await app.inject({method:"PATCH",url:"/api/v1/me/profile/avatar",headers:headers("synthetic-a",userAvatarRevision("synthetic-a",original)),payload:{avatarDataUrl:await image()}});
      expect(result.statusCode).toBe(200);
      const updated=await store.getProfile("synthetic-a"); expect(updated?.preferences).toMatchObject({theme:"dark",operatorProfile:{phone:"synthetic",organization:"TEST"}});
      expect(updated?.alertPreferences).toEqual(original.alertPreferences);
      const decoded=Buffer.from(result.json().avatarDataUrl.split(",")[1],"base64");expect((await sharp(decoded).metadata()).exif).toBeUndefined();expect(decoded.toString()).not.toContain("SYNTHETIC_PRIVATE_METADATA");
      expect((await app.inject({url:"/api/v1/me/profile",headers:headers("synthetic-b")})).json().avatarDataUrl).toBeNull();
      expect((await app.inject({method:"PATCH",url:"/api/v1/me/profile/avatar",headers:headers("synthetic-b",result.json().revision),payload:{avatarDataUrl:null}})).statusCode).toBe(412);
      expect(await store.getProfile("synthetic-b")).toBeNull();
    }finally{await app.close()}
  });
  it("serializes concurrent writes and requires explicit new revision for removal",async()=>{
    const {app}=fixture();try{
      const initial=(await app.inject({url:"/api/v1/me/profile",headers:headers()})).json();const payload={avatarDataUrl:await image()};
      const results=await Promise.all([1,2].map(()=>app.inject({method:"PATCH",url:"/api/v1/me/profile/avatar",headers:headers("synthetic-a",initial.revision),payload})));
      expect(results.map(r=>r.statusCode).sort()).toEqual([200,412]);const saved=results.find(r=>r.statusCode===200)!.json();
      const removed=await app.inject({method:"PATCH",url:"/api/v1/me/profile/avatar",headers:headers("synthetic-a",saved.revision),payload:{avatarDataUrl:null}});expect(removed.statusCode).toBe(200);expect(removed.json().avatarDataUrl).toBeNull();expect(removed.json().revision).not.toBe(saved.revision);
    }finally{await app.close()}
  });
  it("rejects owner injection, arbitrary URLs, SVG, malformed data, missing/stale preconditions",async()=>{
    const {app}=fixture();try{
      const revision=(await app.inject({url:"/api/v1/me/profile",headers:headers()})).json().revision;
      const base={method:"PATCH" as const,url:"/api/v1/me/profile/avatar"};
      expect((await app.inject({...base,headers:headers(),payload:{avatarDataUrl:null}})).statusCode).toBe(428);
      for(const payload of [{subjectId:"synthetic-b",avatarDataUrl:null},{avatarDataUrl:"https://private.example/image"},{avatarDataUrl:"data:image/svg+xml;base64,PHN2Zz4="},{avatarDataUrl:"data:image/jpeg;base64,YmFk"},{avatarDataUrl:"data:image/png;base64,"+"A".repeat(240004)}]) expect((await app.inject({...base,headers:headers("synthetic-a",revision),payload})).statusCode).toBe(400);
      expect((await app.inject({...base,headers:{...headers(),"if-match":"*"},payload:{avatarDataUrl:null}})).statusCode).toBe(400);
    }finally{await app.close()}
  });
  it("returns503 on a failed authoritative store without writing a fallback",async()=>{
    const {app}=fixture(new InMemoryUserProfileStore(),false);try{expect((await app.inject({url:"/api/v1/me/profile",headers:headers()})).statusCode).toBe(503)}finally{await app.close()}
    const store=new InMemoryUserProfileStore();store.getProfile=async()=>{throw Error("injected outage")};const second=fixture(store).app;try{expect((await second.inject({url:"/api/v1/me/profile",headers:headers()})).statusCode).toBe(503)}finally{await second.close()}
  });
  it("rejects mismatching MIME and oversized dimensions",async()=>{
    await expect(canonicalAvatar((await image()).replace("image/jpeg","image/png"))).rejects.toThrow();
    const bytes=await sharp({create:{width:1025,height:1,channels:3,background:"red"}}).png().toBuffer();await expect(canonicalAvatar("data:image/png;base64,"+bytes.toString("base64"))).rejects.toThrow();
  });
});
