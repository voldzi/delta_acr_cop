import {afterEach,describe,expect,it,vi} from "vitest";
import {readVoiceCallPeer} from "./voice-call-peer.js";
import {InMemoryVoiceCallStore} from "./voice-call-store.js";
import {InMemoryUserProfileStore} from "./user-profile-store.js";
import {buildServer} from "./server.js";
const now = new Date("2026-10-05T20:00:00Z");
describe("verified viewer-specific call peer",()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it("binds names to the other exact participant and never uses the shared callee title",async()=>{
  const store = new InMemoryVoiceCallStore(); const profiles = new InMemoryUserProfileStore();
  for(const [subjectId,displayName] of [["caller","Caller name"],["callee","Callee name"]]) await profiles.upsertProfile({subjectId:subjectId!,displayName:displayName!,username:subjectId!,preferences:{},alertPreferences:{}});
  const call = await store.create({roomId:"!room:matrix.test",kind:"direct",initiatorSubjectId:"caller",participantSubjectIds:["callee"],title:"Callee name",now:now.toISOString(),expiresAt:new Date(now.getTime()+90000).toISOString()});
  expect(await readVoiceCallPeer(call,"callee",id=>profiles.getProfile(id))).toEqual({subjectId:"caller",displayName:"Caller name"});
  expect(await readVoiceCallPeer(call,"caller",id=>profiles.getProfile(id))).toEqual({subjectId:"callee",displayName:"Callee name"});
  const spy=vi.fn(); expect(await readVoiceCallPeer(call,"outside",spy)).toBeUndefined();expect(spy).not.toHaveBeenCalled();
  expect(await readVoiceCallPeer(call,"callee",async()=>{throw Error("store outage")})).toEqual({subjectId:"caller"});
  expect(await readVoiceCallPeer(call,"callee",()=>profiles.getProfile("callee"))).toEqual({subjectId:"caller"});
  expect(await readVoiceCallPeer({...call,participantSubjectIds:["callee","other"]},"callee",spy)).toBeUndefined();
 });
 it("adds peer to authenticated call list without changing call, account or notification state",async()=>{
  vi.stubEnv("COP_AUTH_MODE","lab");vi.stubEnv("COP_LAB_TOKEN","synthetic-lab-token");
  const store=new InMemoryVoiceCallStore();const profiles=new InMemoryUserProfileStore();
  await profiles.upsertProfile({subjectId:"caller",displayName:"Caller name",username:"caller",preferences:{},alertPreferences:{}});
  const call=await store.create({roomId:"!room:matrix.test",kind:"direct",initiatorSubjectId:"caller",participantSubjectIds:["lab"],title:"Wrong callee title",now:now.toISOString(),expiresAt:new Date(now.getTime()+90000).toISOString()});
  const before=await store.get(call.callId);const app=buildServer({voiceCallStore:store,userProfileStore:profiles,now:()=>now});
  try{
   const response=await app.inject({method:"GET",url:"/api/v1/messaging/calls",headers:{authorization:"Bearer synthetic-lab-token"}});
   expect(response.statusCode).toBe(200);expect(response.json().calls[0]).toMatchObject({title:"Wrong callee title",direction:"incoming",peer:{subjectId:"caller",displayName:"Caller name"}});
   expect(await store.get(call.callId)).toEqual(before);
   expect((await app.inject({method:"GET",url:"/api/v1/messaging/calls"})).statusCode).toBe(401);
  }finally{await app.close();}
 });
});
