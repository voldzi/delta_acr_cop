import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./security.js";
import type { MessagingProviderConfig } from "./messaging-provider.js";
import { readBoundedBody } from "./bounded-upstream.js";
import { correlationIdFrom, sendError } from "./errors.js";

const contract = "cop-host-pusher-reconcile-v1";
const path = "/api/v1/mobile/host-pushers/reconcile";
const keys = ["contractVersion", "operationId", "appInstanceId", "bundleId", "pushKey", "confirmation"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export interface HostPusherReconciliationInput {
  contractVersion: "cop-host-pusher-reconcile-v1";
  operationId: string;
  appInstanceId: string;
  bundleId: "cz.voldzi.jizda" | "cz.voldzi.copmobile";
  pushKey: string;
  confirmation: "remove_stale_pusher";
}
export class HostPusherReconciliationError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function validateHostPusherInput(value: unknown): HostPusherReconciliationInput {
  if (!record(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k)) ||
      value.contractVersion !== contract || value.confirmation !== "remove_stale_pusher" ||
      typeof value.operationId !== "string" || !uuid.test(value.operationId) ||
      typeof value.appInstanceId !== "string" || !uuid.test(value.appInstanceId) ||
      !["cz.voldzi.jizda", "cz.voldzi.copmobile"].includes(String(value.bundleId)) ||
      typeof value.pushKey !== "string" || !value.pushKey.length || Buffer.byteLength(value.pushKey) > 2048 || /[\u0000-\u001f\u007f]/u.test(value.pushKey)) {
    throw new HostPusherReconciliationError(400, "VALIDATION_ERROR");
  }
  return value as unknown as HostPusherReconciliationInput;
}
export function validateCurrentSessionInput(value:unknown, preparing = false):Record<string,unknown> {
  const fields=["contractVersion","operationId","appInstanceId","bundleId","cleanupOperationId","cleanupTargetFingerprint","deviceId","confirmation"];
  if(!record(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(k=>!fields.includes(k))||
    value.contractVersion!=="cop-host-current-chat-session-v1"||value.confirmation!==(preparing?"prepare_isolated_chat_session":"new_isolated_chat_session")||
    typeof value.operationId!=="string"||!uuid.test(value.operationId)||typeof value.appInstanceId!=="string"||!uuid.test(value.appInstanceId)||
    typeof value.cleanupOperationId!=="string"||!uuid.test(value.cleanupOperationId)||value.cleanupOperationId===value.operationId||
    !["cz.voldzi.jizda","cz.voldzi.copmobile"].includes(String(value.bundleId))||typeof value.cleanupTargetFingerprint!=="string"||!/^[0-9a-f]{64}$/u.test(value.cleanupTargetFingerprint)||
    value.deviceId!=="CSMIOS.S."+value.operationId.replaceAll("-","")) throw new HostPusherReconciliationError(400,"VALIDATION_ERROR");
  return value;
}
export class HostPusherReconciliation {
  private budgets = new Map<string, { window: number; count: number }>();
  constructor(readonly options: {
    config: MessagingProviderConfig; issuer: string; jizdaClientId?: string;
    assertActorActive: (actor: AuthenticatedActor) => Promise<void>;
    assertSessionActorActive?: (actor: AuthenticatedActor) => Promise<void>;
    now?: () => Date; fetch?: typeof fetch;
  }) {}
  private async begin(actor: AuthenticatedActor, now: number) {
    if (actor.authMode !== "oidc" || actor.issuer !== this.options.issuer || !actor.subjectId ||
        !actor.authorizedParty || !["csm-mobile", this.options.jizdaClientId].includes(actor.authorizedParty)) {
      throw new HostPusherReconciliationError(403, "OWNER_NOT_PROVEN");
    }
    if (!Number.isSafeInteger(actor.authTime) || actor.authTime! * 1000 > now + 30_000 || actor.authTime! * 1000 < now - 300_000) {
      throw new HostPusherReconciliationError(401, "REAUTHENTICATION_REQUIRED");
    }
    const config = this.options.config;
    if (!config.enabled || !config.token) throw new HostPusherReconciliationError(503, "RECOVERY_UNAVAILABLE");
    const window = Math.floor(now / 60_000);
    for (const [key, item] of this.budgets) if (item.window !== window) this.budgets.delete(key);
    const budget = this.budgets.get(actor.subjectId) ?? { window, count: 0 };
    if (budget.count >= 6 || this.budgets.size >= 10_000) throw new HostPusherReconciliationError(429, "RATE_LIMITED");
    budget.count++; this.budgets.set(actor.subjectId, budget);
    await this.options.assertActorActive(actor);
  }
  private async checkSessionActor(actor: AuthenticatedActor) {
    try { await this.options.assertSessionActorActive?.(actor); }
    catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 403)
        throw new HostPusherReconciliationError(403,"APP_ACCESS_REVOKED");
      throw new HostPusherReconciliationError(503,"RECOVERY_UNAVAILABLE");
    }
  }
  async capabilities(actor: AuthenticatedActor, enabled: boolean, sessionEnabled: boolean) {
    if (actor.authMode !== "oidc" || actor.issuer !== this.options.issuer || !actor.authorizedParty ||
      !["csm-mobile", this.options.jizdaClientId].includes(actor.authorizedParty)) throw new HostPusherReconciliationError(403, "OWNER_NOT_PROVEN");
    await this.options.assertActorActive(actor);
    let target = false, session = false;
    if (enabled && this.options.config.enabled && this.options.config.token) {
      try {
        const response = await (this.options.fetch ?? fetch)(new URL("/api/v1/matrix/pushers/reconciliation-capabilities", this.options.config.baseUrl), {
          headers: {authorization: `Bearer ${this.options.config.token}`}, redirect:"error", signal:AbortSignal.timeout(Math.min(this.options.config.timeoutMs,5000))
        });
        const body:unknown = JSON.parse((await readBoundedBody(response,4096)).toString("utf8"));
        if (response.status!==200 || !record(body) || Object.keys(body).length!==3 || body.contractVersion!=="csm-host-pusher-recovery-capabilities-v1" ||
          typeof body.exactTargetReconciliationEnabled!=="boolean" || typeof body.isolatedCurrentSessionEnabled!=="boolean") throw new Error("unproven");
        target=body.exactTargetReconciliationEnabled; session=target && sessionEnabled && body.isolatedCurrentSessionEnabled;
      } catch { throw new HostPusherReconciliationError(503,"RECOVERY_UNAVAILABLE"); }
    }
    await this.options.assertActorActive(actor);
    return {contractVersion:"cop-host-pusher-recovery-capabilities-v1",exactTargetReconciliation:{enabled:target,requiresRecentAuthentication:true,maxAuthenticationAgeSeconds:300},
      isolatedCurrentSession:{enabled:session},validUntil:new Date((this.options.now?.() ?? new Date()).getTime()+30_000).toISOString()};
  }
  async openCurrentSession(actor: AuthenticatedActor, value: unknown, preparing = false) {
    const input=validateCurrentSessionInput(value,preparing), now=(this.options.now?.()??new Date()).getTime();
    await this.begin(actor,now);
    await this.checkSessionActor(actor);
    const config=this.options.config;
    if (!config.matrixHomeserverPublicUrl?.startsWith("https://")) throw new HostPusherReconciliationError(503,"RECOVERY_UNAVAILABLE");
    try {
      const response=await (this.options.fetch??fetch)(new URL(preparing?"/api/v1/matrix/sessions/current/prepare":"/api/v1/matrix/sessions/current",config.baseUrl),{
        method:"POST",redirect:"error",signal:AbortSignal.timeout(Math.max(1000,Math.min(config.timeoutMs,30_000))),
        headers:{authorization:`Bearer ${config.token}`,"content-type":"application/json","cache-control":"no-store",
          "x-csm-user-id":actor.subjectId,"x-csm-oidc-issuer":actor.issuer!,"x-csm-app-client-id":actor.authorizedParty!,
          "x-csm-installation-id":String(input.appInstanceId),"x-csm-recovery-auth-time":String(actor.authTime)},body:JSON.stringify(input)
      });
      const body:unknown=JSON.parse((await readBoundedBody(response,256*1024)).toString("utf8"));
      if(response.status!==200) throw new HostPusherReconciliationError([400,401,403,409,429].includes(response.status)?response.status:503,
        response.status===409?"SESSION_NOT_PROVEN":response.status===401?"REAUTHENTICATION_REQUIRED":response.status===429?"RATE_LIMITED":"RECOVERY_UNAVAILABLE");
      if(preparing){
        const fields=["contractVersion","operationId","appInstanceId","bundleId","actorSubjectId","deviceId","userId","homeserverBaseUrl","cleanupOperationId","cleanupTargetFingerprint","validUntil","historyReset"];
        if(!record(body)||Object.keys(body).length!==fields.length||Object.keys(body).some(k=>!fields.includes(k))||
          body.contractVersion!=="cop-host-current-chat-session-prepare-v1"||body.operationId!==input.operationId||body.appInstanceId!==input.appInstanceId||body.bundleId!==input.bundleId||
          body.actorSubjectId!==actor.subjectId||body.deviceId!==input.deviceId||typeof body.userId!=="string"||!/^@[^\s:]+:[^\s]+$/u.test(body.userId)||body.userId.length>1024||
          body.homeserverBaseUrl!==config.matrixHomeserverPublicUrl||body.cleanupOperationId!==input.cleanupOperationId||body.cleanupTargetFingerprint!==input.cleanupTargetFingerprint||
          typeof body.validUntil!=="string"||!Number.isFinite(Date.parse(body.validUntil))||Date.parse(body.validUntil)<=now||Date.parse(body.validUntil)>now+300_000||body.historyReset!==false)
          throw new HostPusherReconciliationError(503,"SESSION_PREPARATION_UNPROVEN");
        await this.options.assertActorActive(actor);
        await this.checkSessionActor(actor);
        return body;
      }
      const fields=["contractVersion","operationId","appInstanceId","bundleId","actorSubjectId","deviceId","userId","accessToken","refreshToken","expiresInMs","homeserverBaseUrl","e2eeRequired","newIsolatedDevice","historyReset"];
      const token=(v:unknown)=>typeof v==="string"&&v.length>0&&Buffer.byteLength(v)<=65536&&!/[\u0000-\u0020\u007f]/u.test(v);
      if(!record(body)||Object.keys(body).length!==fields.length||Object.keys(body).some(k=>!fields.includes(k))||body.contractVersion!==input.contractVersion||
        body.operationId!==input.operationId||body.appInstanceId!==input.appInstanceId||body.bundleId!==input.bundleId||body.actorSubjectId!==actor.subjectId||body.deviceId!==input.deviceId||
        typeof body.userId!=="string"||!/^@[^\s:]+:[^\s]+$/u.test(body.userId)||body.userId.length>1024||!token(body.accessToken)||
        !(body.refreshToken===null||token(body.refreshToken))||!(body.expiresInMs===null||(Number.isSafeInteger(body.expiresInMs)&&Number(body.expiresInMs)>0&&Number(body.expiresInMs)<=31_536_000_000))||
        body.homeserverBaseUrl!==config.matrixHomeserverPublicUrl||body.e2eeRequired!==true||body.newIsolatedDevice!==true||body.historyReset!==false) throw new HostPusherReconciliationError(503,"SESSION_UNPROVEN");
      await this.options.assertActorActive(actor);
      await this.checkSessionActor(actor);
      return body;
    }catch(error){ if(error instanceof HostPusherReconciliationError)throw error;throw new HostPusherReconciliationError(503,"RECOVERY_UNAVAILABLE"); }
  }
  async reconcile(actor: AuthenticatedActor, value: unknown) {
    const input = validateHostPusherInput(value), now = (this.options.now?.() ?? new Date()).getTime();
    await this.begin(actor, now);
    const config = this.options.config;
    const targetFingerprint = createHash("sha256").update(input.bundleId + "\0" + input.pushKey).digest("hex");
    try {
      const response = await (this.options.fetch ?? fetch)(new URL("/api/v1/matrix/pushers/reconcile", config.baseUrl), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(Math.max(1000, Math.min(config.timeoutMs, 30_000))),
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", "cache-control": "no-store",
          "x-csm-user-id": actor.subjectId, "x-csm-oidc-issuer": actor.issuer!,
          "x-csm-app-client-id": actor.authorizedParty!, "x-csm-installation-id": input.appInstanceId,
          "x-csm-recovery-auth-time": String(actor.authTime) }, body: JSON.stringify(input)
      });
      const body: unknown = JSON.parse((await readBoundedBody(response, 8192)).toString("utf8"));
      if (response.status !== 200) {
        const allowed = new Map([[400, "VALIDATION_ERROR"], [401, "REAUTHENTICATION_REQUIRED"], [403, "TARGET_NOT_PROVEN"], [409, "REGISTRATION_CHANGED"], [429, "RATE_LIMITED"]]);
        throw new HostPusherReconciliationError(allowed.has(response.status) ? response.status : 503, allowed.get(response.status) ?? "RECOVERY_UNAVAILABLE");
      }
      const receiptKeys = ["contractVersion", "operationId", "appInstanceId", "bundleId", "actorSubjectId", "targetFingerprint", "outcome", "registryRevision", "matrixDeviceCreated", "chatSessionRestored"];
      if (!record(body) || Object.keys(body).length !== receiptKeys.length || Object.keys(body).some(k => !receiptKeys.includes(k)) ||
          body.contractVersion !== contract || body.operationId !== input.operationId || body.appInstanceId !== input.appInstanceId ||
          body.bundleId !== input.bundleId || body.actorSubjectId !== actor.subjectId || body.targetFingerprint !== targetFingerprint ||
          body.outcome !== "complete" || !Number.isSafeInteger(body.registryRevision) || Number(body.registryRevision) < 0 ||
          body.matrixDeviceCreated !== false || body.chatSessionRestored !== false) {
        throw new HostPusherReconciliationError(503, "RECOVERY_UNPROVEN");
      }
      await this.options.assertActorActive(actor);
      return body;
    } catch (error) {
      if (error instanceof HostPusherReconciliationError) throw error;
      throw new HostPusherReconciliationError(503, "RECOVERY_UNAVAILABLE");
    }
  }
}
export function registerHostPusherReconciliationRoutes(app: FastifyInstance, options: {
  service: HostPusherReconciliation; actor: (request: FastifyRequest) => AuthenticatedActor | null; enabled: () => boolean; sessionEnabled?: () => boolean;
}) {
  app.get("/api/v1/mobile/host-pushers/capabilities",async(request,reply)=>{
    const actor=options.actor(request);
    if(!actor)return sendError(reply,401,"UNAUTHORIZED","Přihlášení COP je nutné.",correlationIdFrom(request.headers["x-correlation-id"]));
    try{return reply.header("cache-control","no-store").send(await options.service.capabilities(actor,options.enabled(),options.sessionEnabled?.()??false));}
    catch{return sendError(reply,503,"RECOVERY_UNAVAILABLE","Obnovu nyní nelze ověřit.",correlationIdFrom(request.headers["x-correlation-id"]));}
  });
  app.post("/api/v1/mobile/host-chat-sessions/prepare",{bodyLimit:8192},async(request,reply)=>{
    const actor=options.actor(request);
    if(!actor)return sendError(reply,401,"UNAUTHORIZED","Přihlášení COP je nutné.",correlationIdFrom(request.headers["x-correlation-id"]));
    if(!options.enabled()||!options.sessionEnabled?.())return sendError(reply,503,"RECOVERY_NOT_ENABLED","Obnovu nyní nelze připravit.",correlationIdFrom(request.headers["x-correlation-id"]));
    try{return reply.header("cache-control","no-store").send(await options.service.openCurrentSession(actor,request.body,true));}
    catch(error){const safe=error instanceof HostPusherReconciliationError?error:new HostPusherReconciliationError(503,"RECOVERY_UNAVAILABLE");
      return sendError(reply,safe.status,safe.code,"Nové přihlášení chatu nelze připravit.",correlationIdFrom(request.headers["x-correlation-id"]));}
  });
  app.post("/api/v1/mobile/host-chat-sessions",{bodyLimit:8192},async(request,reply)=>{
    const actor=options.actor(request);
    if(!actor)return sendError(reply,401,"UNAUTHORIZED","Přihlášení COP je nutné.",correlationIdFrom(request.headers["x-correlation-id"]));
    if(!options.enabled()||!options.sessionEnabled?.())return sendError(reply,503,"RECOVERY_NOT_ENABLED","Obnovu nyní nelze dokončit.",correlationIdFrom(request.headers["x-correlation-id"]));
    try{return reply.header("cache-control","no-store").send(await options.service.openCurrentSession(actor,request.body));}
    catch(error){const safe=error instanceof HostPusherReconciliationError?error:new HostPusherReconciliationError(503,"RECOVERY_UNAVAILABLE");
      return sendError(reply,safe.status,safe.code,"Nové přihlášení chatu nelze dokončit.",correlationIdFrom(request.headers["x-correlation-id"]));}
  });
  app.post(path, { bodyLimit: 8192 }, async (request, reply) => {
    const actor = options.actor(request);
    if (!actor) return sendError(reply, 401, "UNAUTHORIZED", "Přihlášení COP je nutné.", correlationIdFrom(request.headers["x-correlation-id"]));
    if (!options.enabled()) return sendError(reply, 503, "RECOVERY_NOT_ENABLED", "Obnovu nyní nelze dokončit.", correlationIdFrom(request.headers["x-correlation-id"]));
    try { return reply.header("cache-control", "no-store").send(await options.service.reconcile(actor, request.body)); }
    catch (error) {
      const safe = error instanceof HostPusherReconciliationError ? error : new HostPusherReconciliationError(503, "RECOVERY_UNAVAILABLE");
      return sendError(reply, safe.status, safe.code, "Obnovu registrace oznámení nelze dokončit.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
  });
}
