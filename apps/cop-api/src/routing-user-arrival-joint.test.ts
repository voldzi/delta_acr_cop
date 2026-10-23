import { afterEach, describe, expect, it } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { buildServer } from "./server.js";
import { RoutingSourceAdapter } from "./routing-source.js";
import { clearJwksCacheForTests } from "./security.js";
const helper = process.env.SIM_ARRIVAL_HELPER;
const originalEnv = { ...process.env };
const fixture = JSON.parse(readFileSync(new URL("../../../docs/api/examples/user-selected-arrival-v1.fixture.json", import.meta.url), "utf8"));
afterEach(() => { process.env = { ...originalEnv }; clearJwksCacheForTests(); });
describe.skipIf(!helper)("isolated actual SIM RoutingService + COP OIDC HTTP candidate", () => {
  it.each([false,true])("authenticates RS256 before actual SIM; warning401=%s", async warning => {
    const child=spawn(process.execPath,[helper!,...(warning?["--warning401"]:[])],{env:{PATH:process.env.PATH??""},stdio:["ignore","pipe","pipe"]});
    const issuer=createServer();let api:ReturnType<typeof buildServer>|undefined;
    try {
      const endpoint=await new Promise<string>((resolve,reject)=>{let text="";const timer=setTimeout(()=>reject(new Error("ISOLATED_SIM_STARTUP_TIMEOUT")),15000);
        child.once("exit",()=>{clearTimeout(timer);reject(new Error("ISOLATED_SIM_EXITED"));});
        child.stdout.on("data",chunk=>{text+=chunk;if(text.includes("\n")){clearTimeout(timer);const receipt=JSON.parse(text.split("\n")[0]!);expect(receipt.productionConfigLoaded).toBe(false);expect(receipt.implementation).toBe("RoutingService.alternatives");expect(receipt.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/routing\/alternatives$/);resolve(receipt.endpoint);}});
      });
      const pair=generateKeyPairSync("rsa",{modulusLength:2048});const kid="synthetic-arrival-key";
      issuer.on("request",(_req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify({keys:[{...pair.publicKey.export({format:"jwk"}),kid,alg:"RS256",use:"sig"}]}));});
      await new Promise<void>(resolve=>issuer.listen(0,"127.0.0.1",resolve));const address=issuer.address();if(!address||typeof address==="string")throw new Error("TEST_ISSUER_UNAVAILABLE");
      const auth=`http://127.0.0.1:${address.port}`;
      process.env={...originalEnv,COP_AUTH_MODE:"oidc",COP_ALLOW_LAB_TOKEN:"false",COP_PUBLIC_READ_ENABLED:"true",COP_OIDC_ISSUER:auth+"/issuer",COP_OIDC_JWKS_URI:auth+"/jwks",COP_OIDC_ALLOWED_CLIENTS:"csm-mobile",COP_OIDC_CLIENT_ID:"csm-mobile",COP_OIDC_REQUIRED_ROLE:"cop_operator"};clearJwksCacheForTests();
      const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:"RS256",kid})).toString("base64url");
      const payload=Buffer.from(JSON.stringify({iss:auth+"/issuer",sub:"synthetic-arrival-actor",azp:"csm-mobile",iat:now,exp:now+180,realm_access:{roles:["cop_operator"]}})).toString("base64url");
      const signingInput=header+"."+payload,sign=createSign("RSA-SHA256");sign.update(signingInput);sign.end();const token=signingInput+"."+sign.sign(pair.privateKey).toString("base64url");
      api=buildServer({routingSource:new RoutingSourceAdapter({enabled:true,baseUrl:endpoint.replace(/\/routing\/alternatives$/,""),timeoutMs:10000})});
      const origin=await api.listen({host:"127.0.0.1",port:0});
      for(const unauthorized of [undefined,"dev-lab-token","invalid.jwt.signature"]){
        const rejected=await fetch(origin+"/api/v1/routing/route",{method:"POST",headers:{"content-type":"application/json",...(unauthorized?{authorization:"Bearer "+unauthorized}:{})},body:JSON.stringify(fixture.request)});
        expect(rejected.status).toBe(401);
      }
      const result=await fetch(origin+"/api/v1/routing/route",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify(fixture.request)});
      const body=await result.json();
      if(warning){expect(result.status).toBe(422);expect(body.error.code).toBe("ROUTING_RESTRICTIONS_RELAXATION_REQUIRED");expect(body).not.toHaveProperty("routes");}
      else{
        expect(result.status).toBe(200);expect(body.routes).toHaveLength(2);
        for(const route of body.routes){expect(route.arrival.remainingAccess).toBe("unverified");expect(route.steps).toHaveLength(2);expect(body.features.find((f:{id:string})=>f.id===route.routeId).properties.arrival).toEqual(route.arrival);}
        if(process.env.ARRIVAL_SDK_FIXTURE_OUT)writeFileSync(process.env.ARRIVAL_SDK_FIXTURE_OUT,JSON.stringify({fixtureKind:"isolated_authenticated_candidate_mock_engine_not_production",validationNow:new Date().toISOString(),request:fixture.request,response:body,capabilities:fixture.capabilities},null,2)+"\n",{mode:0o600});
      }
    } finally {
      await api?.close();issuer.closeAllConnections();await new Promise<void>(resolve=>issuer.close(()=>resolve()));
      child.kill("SIGTERM");if(child.exitCode===null)await new Promise<void>(resolve=>child.once("exit",()=>resolve()));
    }
  },30000);
});
