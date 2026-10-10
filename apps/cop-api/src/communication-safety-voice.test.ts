import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { CsmMessagingProvider } from "./messaging-provider.js";
import { CommunicationSafetyService } from "./communication-safety.js";
import { MemoryMobilityStore } from "./mobility-store.js";
import { InMemoryVoiceCallStore } from "./voice-call-store.js";
const now=new Date("2026-10-10T10:00:00Z"),headers={authorization:"Bearer test-lab-token"};
function setup() {
  vi.stubEnv("COP_AUTH_MODE","lab");vi.stubEnv("COP_LAB_TOKEN","test-lab-token");vi.stubEnv("COP_ALLOW_LAB_TOKEN","true");
  const provider=new CsmMessagingProvider({baseUrl:"http://messaging.test",enabled:false,cacheTtlMs:0,timeoutMs:100});
  vi.spyOn(provider,"fetchConversationByRoomId").mockResolvedValue({contractVersion:"cop-messaging-conversations-v1",enabled:true,providerId:"csm.messaging",status:"online",warnings:[],conversation:{conversationId:"conversation",conversationKind:"direct",type:"direct",title:"synthetic",members:[{userId:"lab"},{userId:"peer"}],directPeer:{userId:"peer"}}});
  const notify=vi.spyOn(provider,"sendNotification").mockResolvedValue({contractVersion:"cop-messaging-notification-v1",enabled:true,providerId:"csm.messaging",status:"online",warnings:[]});
  const policy={block:vi.fn(async()=>true),directAllowed:vi.fn(async()=>false),eventMatchesPeer:vi.fn(async()=>true)};
  const safety=new CommunicationSafetyService({store:new MemoryMobilityStore(),policy,encryptionSecret:"test-communication-evidence-secret",moderatorRole:"cop-moderator",contactEmail:"test@example.test",retentionPolicyId:"test-only",validateTarget:async()=>{}});
  const store=new InMemoryVoiceCallStore(),issue=vi.fn(async()=>({e2eeKey:"test-only",expiresAt:new Date(now.getTime()+60000).toISOString(),serverUrl:"wss://media.test",token:"test-only"}));
  const app=buildServer({messagingProvider:provider,communicationSafety:safety,voiceCallStore:store,voiceCallMediaIssuer:{enabled:true,issue},now:()=>now});
  return {app,store,issue,policy,notify};
}
describe("call policy in actual COP routes",()=>{
  afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
  it("denies blocked start before creating a call or a wake",async()=>{
    const {app,store,issue,notify}=setup();try {
      const r=await app.inject({method:"POST",url:"/api/v1/messaging/calls",headers,payload:{roomId:"!room:test"}});
      expect(r.statusCode).toBe(403);expect(r.json().error.code).toBe("COMMUNICATION_BLOCKED");
      expect(await store.listForSubject("lab",{activeOnly:true,limit:10})).toHaveLength(0);expect(issue).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
      const tools=await app.inject({url:"/api/v1/mcp/tools",headers});
      expect(tools.statusCode).toBe(200);
      expect(tools.json().items.map((t:{toolId:string})=>t.toolId).filter((id:string)=>/communication|moderation/u.test(id))).toEqual([]);
    }finally{await app.close();}
  });
  it("denies accept and media refresh, preserving a usable end action",async()=>{
    const {app,store,issue}=setup();try {
      const call=await store.create({roomId:"!room:test",initiatorSubjectId:"peer",participantSubjectIds:["lab"],kind:"direct",title:"test",now:now.toISOString(),expiresAt:new Date(now.getTime()+90000).toISOString()});
      const accept=await app.inject({method:"POST",url:`/api/v1/messaging/calls/${call.callId}/actions`,headers,payload:{action:"accept"}});
      expect(accept.statusCode).toBe(403);expect((await store.get(call.callId))?.phase).toBe("ringing");
      await store.transition(call.callId,{action:"accept",actorSubjectId:"lab",now:now.toISOString()});
      const detail=await app.inject({url:`/api/v1/messaging/calls/${call.callId}`,headers});
      expect(detail.statusCode).toBe(403);expect(issue).not.toHaveBeenCalled();
      const end=await app.inject({method:"POST",url:`/api/v1/messaging/calls/${call.callId}/actions`,headers,payload:{action:"end"}});
      expect(end.statusCode).toBe(200);expect((await store.get(call.callId))?.phase).toBe("ended");
    }finally{await app.close();}
  });
  it("fails closed on provider outage and rechecks before initial media grant",async()=>{
    const {app,store,issue,policy}=setup();try {
      policy.directAllowed.mockRejectedValueOnce(new Error("private provider outage"));
      expect((await app.inject({method:"POST",url:"/api/v1/messaging/calls",headers,payload:{roomId:"!room:test"}})).statusCode).toBe(503);
      policy.directAllowed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const race=await app.inject({method:"POST",url:"/api/v1/messaging/calls",headers,payload:{roomId:"!room:test"}});
      expect(race.statusCode).toBe(403);expect(issue).not.toHaveBeenCalled();
      const records=await store.listForSubject("lab",{activeOnly:false,limit:10});expect(records).toHaveLength(1);expect(records[0]?.phase).toBe("failed");
    }finally{await app.close();}
  });
});
