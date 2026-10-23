import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoutingSourceAdapter } from "./routing-source.js";
import { arrivalDistance, verifyUserArrivalResponse, UserArrivalVerificationError, UserArrivalRequestError } from "./routing-user-arrival.js";
import { routingHash } from "./routing-trip.js";
import { buildServer } from "./server.js";
const raw = JSON.parse(readFileSync(new URL("../../../docs/api/examples/user-selected-arrival-v1.fixture.json", import.meta.url), "utf8"));
const fixture = () => structuredClone(raw);
const adapter = () => new RoutingSourceAdapter({ enabled: true, baseUrl: "https://synthetic-sim.invalid/api/v1", timeoutMs: 1000 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("explicit user-selected arrival", () => {
  it("uses exactly the shared OpenAPI schemas and synthetic request/response fixture", async () => {
    const schema = JSON.parse(readFileSync(new URL("../../../docs/api/schemas/user-selected-arrival-v1.schemas.json", import.meta.url), "utf8"));
    const api = JSON.parse(readFileSync(new URL("../../../openapi/openapi.json", import.meta.url), "utf8"));
    for (const [key, value] of Object.entries(schema.components.schemas)) expect(api.components.schemas[key]).toEqual(value);
    const f = fixture(); const original = structuredClone(f.response);
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { expect(JSON.parse(String(init?.body))).toEqual(f.request); return new Response(JSON.stringify(f.response)); });
    vi.stubGlobal("fetch", fetch);
    const result = await adapter().route(f.request, new Date(f.validationNow));
    expect(result.routes).toEqual(original.routes); expect(result.features).toEqual(original.features); expect(result.query).toEqual(original.query);
    expect(result.routes[0]!.durationSeconds).toBe(49); expect(result.routes[0]!.arrival!.distanceM).toBeGreaterThan(26);
    expect(f.request.to).not.toEqual(f.request.arrival.target); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["route", "alternatives"] as const)("passes only authenticated %s HTTP→adapter→mock-SIM results, without claiming live E2E", async endpoint => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(f.response))));
    const app = buildServer({ routingSource: adapter(), now: () => new Date(f.validationNow) });
    try {
      const noActor = await app.inject({ method:"POST", url:`/api/v1/routing/${endpoint}`,payload:f.request }); expect(noActor.statusCode).toBe(401);
      const result = await app.inject({ method:"POST", url:`/api/v1/routing/${endpoint}`,headers:{authorization:"Bearer dev-lab-token"},payload:f.request });
      expect(result.statusCode).toBe(200); expect(result.json().routes.map((r: {arrival:unknown})=>r.arrival)).toEqual(f.response.routes.map((r: {arrival:unknown})=>r.arrival));
    } finally { await app.close(); }
  });
  it.each(["route", "alternatives"] as const)("preserves warning401 typed rejection through %s without routes or retries", async endpoint => {
    const f=fixture();const fetch=vi.fn(async()=>new Response(JSON.stringify(f.error),{status:422}));vi.stubGlobal("fetch",fetch);
    const app=buildServer({routingSource:adapter()});
    try{const result=await app.inject({method:"POST",url:`/api/v1/routing/${endpoint}`,headers:{authorization:"Bearer dev-lab-token","x-correlation-id":"warning401-test"},payload:{from:f.request.from,to:f.request.arrival.target,profileId:"car"}});
      expect(result.statusCode).toBe(422);expect(result.json().error.code).toBe("ROUTING_RESTRICTIONS_RELAXATION_REQUIRED");expect(result.json().error.correlationId).toBe("warning401-test");expect(result.json()).not.toHaveProperty("routes");expect(fetch).toHaveBeenCalledTimes(1);
    }finally{await app.close();}
  });
  it("does not silently accept unsupported profiles, stops, strict or automatic selection", async()=>{
    const f=fixture(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    for(const addition of [{profileId:"offroad_4x4"},{vehicle:{}},{vehicleProfile:{}},{trip:{}},{via:[]},{departureTime:"2026-10-23T12:00:00Z"},{includeSteps:false},{alternatives:4}]){
      await expect(adapter().route({...f.request,...addition},new Date(f.validationNow))).rejects.toBeInstanceOf(UserArrivalRequestError);
    }
    for(const arrival of [{...f.request.arrival,version:"unknown"},{...f.request.arrival,selection:"automatic"},{...f.request.arrival,target:{lat:91,lon:17}}, {...f.request.arrival,privateAccessAllowed:true}])await expect(adapter().route({...f.request,arrival},new Date(f.validationNow))).rejects.toThrow(/^Routing /);
    await expect(adapter().route({...f.request,arrival:{...f.request.arrival,target:{lat:51,lon:17}}},new Date(f.validationNow))).rejects.toMatchObject({code:"ROUTING_ARRIVAL_TOO_DISTANT"});
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([24,25,26,27])("allows an unverified POI offset %sm without widening snap or extending geometry", offset=>{
    const f=fixture(),end=f.response.routes[0].arrival.mappedEndpoint;const target={lat:end.lat+offset/6371000*180/Math.PI,lon:end.lon};
    f.request.arrival.target=target;f.response.query.arrival.target=target;
    for(const route of f.response.routes){route.arrival.target=target;route.arrival.distanceM=arrivalDistance(end,target);route.arrival.requestHash=routingHash(f.response.query);route.knownClosures.requestHash=routingHash(f.response.query);}
    f.response.features.forEach((feature: {properties:{arrival:unknown}},i:number)=>feature.properties.arrival=structuredClone(f.response.routes[i].arrival));
    expect(()=>verifyUserArrivalResponse(f.response,f.request,new Date(f.validationNow),true)).not.toThrow();
  });
  it.each([24,25,26,27])("keeps separate road snap <=25m (tested %sm)", snap=>{
    const f=fixture(),end=f.response.routes[0].arrival.mappedEndpoint;
    f.request.to={lat:end.lat+snap/6371000*180/Math.PI,lon:end.lon};
    f.response.query.to=f.request.to;
    for(const route of f.response.routes){route.arrival.requestedAccess=f.request.to;route.arrival.snapDistanceM=arrivalDistance(end,f.request.to);route.arrival.requestHash=routingHash(f.response.query);route.knownClosures.requestHash=routingHash(f.response.query);}
    f.response.features.forEach((feature: {properties:{arrival:unknown}},i:number)=>feature.properties.arrival=structuredClone(f.response.routes[i].arrival));
    const check=()=>verifyUserArrivalResponse(f.response,f.request,new Date(f.validationNow),true);
    if(snap<25)expect(check).not.toThrow();else if(snap>25)expect(check).toThrow(UserArrivalVerificationError);else { /* floating point boundary is never rounded up to allow >25 */ if(f.response.routes[0].arrival.snapDistanceM<=25)expect(check).not.toThrow();else expect(check).toThrow(UserArrivalVerificationError); }
  });
  it.each([
    ["one missing variant",(f: ReturnType<typeof fixture>)=>{delete f.response.routes[1].arrival;}],
    ["different target",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.target.lon+=0.001;}],
    ["forged endpoint",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.mappedEndpoint.lon+=0.001;}],
    ["geometry hash",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.geometryHash="0".repeat(64);}],
    ["request hash",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.requestHash="0".repeat(64);}],
    ["route pairing",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.routeId=f.response.routes[1].routeId;}],
    ["feature drift",(f: ReturnType<typeof fixture>)=>{delete f.response.features[1].properties.arrival;}],
    ["stale proof",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.validUntil=f.validationNow;}],
    ["overlong proof",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.validUntil="2026-10-23T12:10:01Z";}],
    ["other graph",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.routingDataset.version="different";}],
    ["other closure revision",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.closureRevision="0".repeat(64);}],
    ["provider fallback",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.engine.fallbackUsed=true;}],
    ["truck costing",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].vehicleAssessment.providerCosting="truck";}],
    ["claimed access",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.remainingAccess="verified";}],
    ["unknown property",(f: ReturnType<typeof fixture>)=>{f.response.routes[0].arrival.walkingEtaSeconds=20;}]
  ])("rejects %s before filtering a variant",(_name,mutate)=>{
    const f=fixture();mutate(f);expect(()=>verifyUserArrivalResponse(f.response,f.request,new Date(f.validationNow),true)).toThrow(UserArrivalVerificationError);
  });
  it("requires closure proof and never sends new metadata to an unopted-in client",()=>{
    const f=fixture();expect(()=>verifyUserArrivalResponse(f.response,f.request,new Date(f.validationNow),false)).toThrow(UserArrivalVerificationError);
    const old={...f.request};delete old.arrival;expect(()=>verifyUserArrivalResponse(f.response,old,new Date(f.validationNow),true)).toThrow(UserArrivalVerificationError);
    for(const r of f.response.routes)delete r.arrival;for(const feature of f.response.features)delete feature.properties.arrival;
    expect(()=>verifyUserArrivalResponse(f.response,old,new Date(f.validationNow),true)).not.toThrow();
  });
  it("passes exact capabilities and rejects falsely widened limits",async()=>{
    const f=fixture();vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({profiles:[],warnings:[],userSelectedArrival:f.capabilities}))));
    expect((await adapter().fetchProfiles(new Date(f.validationNow))).userSelectedArrival).toEqual(f.capabilities);
    f.capabilities.maxSnapDistanceM=27;await expect(adapter().fetchProfiles(new Date(f.validationNow))).rejects.toBeInstanceOf(UserArrivalVerificationError);
  });
});
