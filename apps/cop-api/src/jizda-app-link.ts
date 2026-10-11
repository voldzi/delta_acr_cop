import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./security.js";
import { actorFromRequest } from "./security.js";
import type { MobilityStore } from "./mobility-store.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { readBoundedBody } from "./bounded-upstream.js";

export interface JizdaCleanupProof {
  pushRegistrationsRemoved: boolean;
  legacyInstallationsResolved: boolean;
  matrixDevicesRevoked: boolean;
  livePermissionsRevoked: boolean;
}
export interface JizdaLinkReceipt {
  contractVersion: "cop-jizda-link-v1";
  app: "jizda";
  scope: "jizda_app_link";
  operationId: string;
  status: "disconnecting" | "disconnected";
  requestedAt: string;
  accountDeleted: false;
  localDataDeleted: false;
  remaining: string[];
}
export class JizdaLinkError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const path = "/api/v1/me/app-links/jizda";

/** A shared csm-mobile token or a caller's bundle/header is never app-scope proof. */
export class JizdaAppLinkService {
  private initialized?: Promise<void>;
  constructor(readonly options: { store: MobilityStore; clientId: string; issuer: string;
    cleanup: (actor: AuthenticatedActor, operationId: string) => Promise<JizdaCleanupProof>; intakeEnabled?: boolean; now?: () => Date }) {
    if (!options.issuer || !options.clientId || ["csm-mobile", "cop-web"].includes(options.clientId)) {
      throw new Error("Jizda requires a separate verified OIDC client.");
    }
  }
  provesScope(actor: AuthenticatedActor) {
    return actor.authMode === "oidc" && actor.issuer === this.options.issuer && actor.authorizedParty === this.options.clientId;
  }
  async init(): Promise<void> {
    if (!this.initialized) this.initialized = this.options.store.transact(["jizda-app-link:configuration-v1"], async tx => {
      const fingerprint = createHash("sha256").update(JSON.stringify([this.options.issuer,this.options.clientId])).digest("hex");
      const saved = await tx.get<{fingerprint:string}>("jizda-app-link:configuration-v1");
      if (saved && saved.fingerprint !== fingerprint) throw new JizdaLinkError(503,"JIZDA_SCOPE_CONFIGURATION_CHANGED");
      if (!saved) await tx.set("jizda-app-link:configuration-v1",{fingerprint});
    }).catch(error=>{this.initialized=undefined;throw error instanceof JizdaLinkError?error:new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");});
    await this.initialized;
  }
  private requireScope(actor: AuthenticatedActor) {
    if (!this.provesScope(actor)) throw new JizdaLinkError(403, "APP_SCOPE_NOT_PROVEN");
  }
  private key(actor: AuthenticatedActor) {
    return "jizda-app-link:" + createHash("sha256").update(JSON.stringify([actor.issuer, actor.subjectId, this.options.clientId])).digest("hex");
  }
  async read(actor: AuthenticatedActor): Promise<JizdaLinkReceipt | null> {
    this.requireScope(actor);
    await this.init();
    return this.options.store.transact([], async tx => await tx.get<JizdaLinkReceipt>(this.key(actor)) ?? null);
  }
  async assertAllowed(actor: AuthenticatedActor) {
    if (!this.provesScope(actor)) return; // Other apps retain their existing authority.
    if (await this.read(actor)) throw new JizdaLinkError(403, "JIZDA_LINK_DISCONNECTED");
  }
  async disconnect(actor: AuthenticatedActor, operationId: string): Promise<JizdaLinkReceipt> {
    this.requireScope(actor);
    if (!operationPattern.test(operationId)) throw new JizdaLinkError(400, "VALIDATION_ERROR");
    operationId = operationId.toLowerCase();
    await this.init();
    const key = this.key(actor);
    const receipt = await this.options.store.transact([key], async tx => {
      const existing = await tx.get<JizdaLinkReceipt>(key);
      if (existing) {
        if (existing.operationId !== operationId) throw new JizdaLinkError(409,"IDEMPOTENCY_CONFLICT");
        return existing;
      }
      if (this.options.intakeEnabled === false) throw new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");
      const value: JizdaLinkReceipt = { contractVersion: "cop-jizda-link-v1", app: "jizda", scope: "jizda_app_link",
        operationId, status: "disconnecting", requestedAt: (this.options.now?.() ?? new Date()).toISOString(),
        accountDeleted: false, localDataDeleted: false,
        remaining: ["push_registrations", "legacy_installations", "matrix_devices", "live_permissions"] };
      await tx.set(key,value); // Durable fence before an upstream handoff. Never undo on failure.
      return value;
    });
    if (receipt.status === "disconnected") return receipt;
    let proof: JizdaCleanupProof;
    try { proof = await this.options.cleanup(actor, receipt.operationId); }
    catch { throw new JizdaLinkError(503, "JIZDA_DISCONNECT_UNAVAILABLE"); }
    const remaining = [
      ...(!proof.pushRegistrationsRemoved ? ["push_registrations"] : []),
      ...(!proof.legacyInstallationsResolved ? ["legacy_installations"] : []),
      ...(!proof.matrixDevicesRevoked ? ["matrix_devices"] : []),
      ...(!proof.livePermissionsRevoked ? ["live_permissions"] : [])
    ];
    return this.options.store.transact([key], async tx => {
      const current = await tx.get<JizdaLinkReceipt>(key);
      if (!current) throw new JizdaLinkError(503, "JIZDA_DISCONNECT_UNAVAILABLE");
      if (current.status === "disconnected") return current;
      const next: JizdaLinkReceipt = { ...current, status: remaining.length ? "disconnecting" : "disconnected", remaining };
      await tx.set(key,next);
      return next;
    });
  }
}

/** Only server-attested app rows can be removed; unknown legacy state stays pending. */
export async function disconnectJizdaMessaging(actor: AuthenticatedActor, config: {baseUrl:string;token?:string;timeoutMs:number}): Promise<JizdaCleanupProof> {
  if (!config.token) throw new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");
  const response = await fetch(config.baseUrl.replace(/\/$/u, "") + "/api/v1/communication/jizda-disconnect", {
    method:"POST", headers:{authorization:`Bearer ${config.token}`,"x-csm-user-id":actor.subjectId,
      ...(actor.issuer ? {"x-csm-oidc-issuer":actor.issuer} : {}),
      ...(actor.authorizedParty ? {"x-csm-app-client-id":actor.authorizedParty} : {})},
    redirect:"error",signal:AbortSignal.timeout(Math.min(config.timeoutMs,10000))
  });
  if (response.status !== 200) { await response.body?.cancel(); throw new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE"); }
  const body = JSON.parse((await readBoundedBody(response,32768)).toString("utf8")) as Record<string,unknown>;
  const keys=["contractVersion","pushRegistrationsRemoved","legacyInstallationsResolved","matrixDevicesRevoked","livePermissionsRevoked"];
  if (Object.keys(body).length !== keys.length || Object.keys(body).some(key=>!keys.includes(key)) ||
      body.contractVersion !== "csm-jizda-disconnect-v1" || body.pushRegistrationsRemoved !== true ||
      typeof body.legacyInstallationsResolved !== "boolean" || typeof body.matrixDevicesRevoked !== "boolean" ||
      body.livePermissionsRevoked !== false) {
    throw new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");
  }
  return {pushRegistrationsRemoved:true,legacyInstallationsResolved:body.legacyInstallationsResolved,
    matrixDevicesRevoked:body.matrixDevicesRevoked,livePermissionsRevoked:false};
}

export function registerJizdaAppLinkRoutes(app:FastifyInstance, service?:JizdaAppLinkService,
  verifiedActor:(request:FastifyRequest)=>AuthenticatedActor|null = actorFromRequest) {
  const actor = (r:FastifyRequest) => {
    const a=verifiedActor(r);
    if (!a || a.authMode!=="oidc" || !a.issuer) throw new JizdaLinkError(401,"UNAUTHORIZED");
    return a;
  };
  const error = (r:FastifyRequest,reply:Parameters<typeof sendError>[0],e:unknown) => {
    const known=e instanceof JizdaLinkError?e:new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");
    return sendError(reply,known.status,known.code,"Odpojení Jízdy nyní nelze dokončit.",correlationIdFrom(r.headers["x-correlation-id"]));
  };
  app.addHook("onRequest",async(r,reply)=>{
    if (r.url.startsWith("/health") || r.url.split("?")[0]==="/metrics") return;
    if (!service || r.method==="OPTIONS" || [path,path+"/capabilities",path+"/disconnect"].includes(r.url.split("?")[0]!)) return;
    const a=verifiedActor(r); if (!a) return;
    try { await service.assertAllowed(a); } catch(e) { return error(r,reply,e); }
  });
  app.get(path+"/capabilities",async(r,reply)=>{
    reply.header("Cache-Control","no-store");
    try { const a=actor(r); return {contractVersion:"cop-jizda-link-v1",app:"jizda",scope:"jizda_app_link",
      disconnectAvailable:!!service?.provesScope(a) && service.options.intakeEnabled !== false,accountDeletion:false,localDataDeleted:false,
      ...(!service || service.options.intakeEnabled === false ? {unavailableReason:"not_enabled"} :
        !service.provesScope(a) ? {unavailableReason:"app_identity_not_separated"} : {})}; }
    catch(e) {return error(r,reply,e);}
  });
  app.get(path,async(r,reply)=>{
    reply.header("Cache-Control","no-store");
    try { const a=actor(r); if (!service) throw new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");
      const receipt=await service.read(a); return receipt??{contractVersion:"cop-jizda-link-v1",app:"jizda",scope:"jizda_app_link",status:"linked",accountDeleted:false,localDataDeleted:false}; }
    catch(e) {return error(r,reply,e);}
  });
  app.post(path+"/disconnect",{bodyLimit:1024,config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async(r,reply)=>{
    reply.header("Cache-Control","no-store");
    try {const a=actor(r); if (!service) throw new JizdaLinkError(503,"JIZDA_DISCONNECT_UNAVAILABLE");
      if (r.body !== undefined || typeof r.headers["idempotency-key"] !== "string") throw new JizdaLinkError(400,"VALIDATION_ERROR");
      const receipt=await service.disconnect(a,r.headers["idempotency-key"]);
      return reply.code(receipt.status==="disconnected"?200:202).send(receipt);
    } catch(e) {return error(r,reply,e);}
  });
}
