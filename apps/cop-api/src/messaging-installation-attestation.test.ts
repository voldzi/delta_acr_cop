import { afterEach, describe, expect, it, vi } from "vitest";
import { CsmMessagingProvider } from "./messaging-provider.js";
import type { AuthenticatedActor } from "./security.js";
const installation="90712931-e0a3-48bf-b682-0d6887f46475";
const actor:AuthenticatedActor={authMode:"oidc",issuer:"https://identity.test/realms/cop",authorizedParty:"jizda-mobile",subjectId:"synthetic-account-a",username:"",displayName:""};
function provider(){return new CsmMessagingProvider({baseUrl:"https://messaging.test",token:"synthetic-service-token",timeoutMs:100,cacheTtlMs:0,enabled:true});}
afterEach(()=>{vi.unstubAllGlobals();});
describe("Matrix installation attestation transport",()=>{
  it("sends exact verified app/issuer/account and installation without putting authority in the client body",async()=>{
    const fetchMock=vi.fn(async()=>new Response("{}"));vi.stubGlobal("fetch",fetchMock);
    await provider().fetchMatrixBootstrap(actor,new Date(),"JIZDA.device",installation.toUpperCase());
    const [,options]=fetchMock.mock.calls[0] as unknown as [unknown,RequestInit];
    expect(options.headers).toMatchObject({Authorization:"Bearer synthetic-service-token","x-csm-user-id":actor.subjectId,
      "x-csm-app-client-id":"jizda-mobile","x-csm-oidc-issuer":actor.issuer,"x-csm-installation-id":installation});
    expect(JSON.parse(options.body as string)).toEqual({deviceId:"JIZDA.device"});
    expect(options.redirect).toBe("error");
  });
  it("never downgrades malformed or unverified app context to a legacy provider request",async()=>{
    const fetchMock=vi.fn(async()=>new Response("{}"));vi.stubGlobal("fetch",fetchMock);
    for(const invalid of [{...actor,authMode:"lab" as const},{...actor,authorizedParty:undefined},{...actor,issuer:"https://id.test/\nforged"},
      {...actor,subjectId:"zaščitená-identita"}]) {
      const result=await provider().fetchMatrixBootstrap(invalid,new Date(),"JIZDA.device",installation);
      expect(result.status).toBe("degraded");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
