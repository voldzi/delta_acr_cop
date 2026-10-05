import { MobilityInvitationOutbox } from "../mobility-invitation-outbox.js";
import type { FastifyInstance } from "fastify";
import { actorFromRequest } from "../security.js";
import { correlationIdFrom, sendError } from "../errors.js";
import { acceptsMobilitySchema, mobilityContract, normalizeMobilityInput } from "../mobility-contract.js";
import { MobilityFailure } from "../mobility-service.js";
import { SharedMobilityService } from "../mobility-invitations.js";
import type { MobilityStore } from "../mobility-store.js";
import type * as Wire from "../mobility-types.js";

import type { MessagingProvider } from "../messaging-provider.js";
import { openDispatchParticipant } from "../mobility-participant.js";
type Options = { messagingProvider?: MessagingProvider; enabled: boolean; dispatchEnabled: boolean; store?: MobilityStore; now: () => Date };
export function registerMobilityRoutes(app: FastifyInstance, options: Options): () => { name: string; status: "ok" | "unavailable" | "disabled"; detail: string } {
  const service = options.store ? new SharedMobilityService(options.store, options.now) : undefined;
  if (options.enabled && !service) throw new Error("Shared mobility requires durable storage.");
  if (options.dispatchEnabled && !options.enabled) throw new Error("Private Dispatch requires shared mobility.");
  const invitationOutbox = options.enabled && options.store && options.messagingProvider ? new MobilityInvitationOutbox(options.store, options.messagingProvider, options.now) : undefined;
  let retentionTimer: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => { if (options.enabled) { await options.store!.init(); await service!.pruneRetainedData(); invitationOutbox?.start(); retentionTimer = setInterval(() => { void service!.pruneRetainedData().catch(() => undefined); }, 3600000); retentionTimer.unref(); if (options.dispatchEnabled) await service!.initializeDispatch((state, generation) => { app.log.info({ component: "private-dispatch", state, generation }, "Dispatch lease state changed."); }); } });
  app.addHook("onClose", async () => { if (retentionTimer) clearInterval(retentionTimer); service?.closeDispatch(); await invitationOutbox?.close(); if (options.enabled) await options.store?.close(); });
  for (const [path, methods] of Object.entries(mobilityContract.paths)) for (const [method, operation] of Object.entries(methods)) {
    const routePath = path.replace(/\{([^}]+)\}/gu, ":$1");
    app.route({ method: method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH", url: routePath,
      bodyLimit: 4 * 1024 * 1024, logLevel: "silent",
      handler: async (request, reply) => {
        const correlationId = correlationIdFrom(request.headers["x-correlation-id"]); reply.header("Cache-Control", "no-store");
        const actor = actorFromRequest(request);
        if (!actor || actor.authMode !== "oidc" || !actor.issuer) return sendError(reply, 401, "UNAUTHORIZED", "Je nutná ověřená identita COP.", correlationId);
        try {
          if (operation.operationId === "mobilityCapabilities") {
            let databaseAvailable = true;
            if (options.enabled) { try { await options.store!.transact([], async () => true); } catch { databaseAvailable = false; } }
            return { contractVersion: "cop-mobility-capabilities-v1", sharedVehiclesEnabled: options.enabled, dispatchEnabled: options.dispatchEnabled,
              maxVehicleMembers: 5, maxGroupMembers: 200, registration: "unverified", invitationDelivery: "verified_account_inbox",
              dispatchTransport: "recipient_encrypted_latest_only", currencies: ["CZK", "EUR", "USD"], serverTimestamp: options.now().toISOString(),
              odometerSnapshotVersions: [1, 2], rideDetailsVersions: [1], initialOdometerSupported: true, rideInsertPolicy: "append_only_membership_cas",
              recordDetailsVersions: [1], recordEnergyUnits: ["liters", "kWh"], supportedRefuelingFuelTypes: ["natural95", "natural98", "natural100", "diesel", "diesel plus", "lpg", "bioEthanol"],
              serviceAvailability: { sharedVehicles: !options.enabled ? "disabled" : databaseAvailable ? "ready" : "unavailable",
                dispatch: !options.dispatchEnabled ? "disabled" : !databaseAvailable ? "unavailable" : options.store!.dispatchState(),
                checkedAt: options.now().toISOString() } } satisfies Wire.MobilityCapabilities;
          }
          if (!options.enabled || !service || (path.includes("private-dispatch") && !options.dispatchEnabled)) return sendError(reply, 503, "MOBILITY_DISABLED", "Sdílení není zapnuto.", correlationId);
          if (path.includes("private-dispatch") && !options.store!.dispatchIsAvailable()) throw new MobilityFailure(503, "DISPATCH_UNAVAILABLE", "Šifrovaný kanál není dostupný.");
          const params = request.params as Record<string, string>; const query = request.query as Record<string, string>;
          for (const value of Object.values(params)) if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new MobilityFailure(400, "VALIDATION_ERROR", "Neplatný identifikátor.");
          const allowedQuery = operation.operationId === "sharedVehicleSync" ? ["cursor", "limit"] : operation.operationId === "dispatchSnapshot" ? ["deviceId"] : [];
          if (Object.keys(query).some(key => !allowedQuery.includes(key))) throw new MobilityFailure(400, "VALIDATION_ERROR", "Nepovolené parametry požadavku.");
          const ref = operation.requestBody?.content["application/json"].schema.$ref;
          const bodySchema = ref?.split("/").at(-1);
          if (bodySchema && !acceptsMobilitySchema(bodySchema, request.body)) throw new MobilityFailure(400, "VALIDATION_ERROR", "Neplatná struktura požadavku.");
          if (!bodySchema && request.body !== undefined) throw new MobilityFailure(400, "VALIDATION_ERROR", "Tato operace nepřijímá obsah.");
          if (!bodySchema && request.body !== undefined) throw new MobilityFailure(400, "VALIDATION_ERROR", "Tato operace nepřijímá obsah.");
          const body: unknown = bodySchema ? normalizeMobilityInput(bodySchema, request.body) : undefined;
          const execute = async () => {
          const account = await service.account(actor); const id = (params.vehicleId ?? params.groupId ?? params.shareId ?? "").toLowerCase();
          switch (operation.operationId) {
            case "mobilityAccount": return account;
            case "mobilityInvitations": return await service.pendingInvitations(account);
            case "sharedVehicles": return await service.listVehicles(account);
            case "sharedVehicleCreate": return {operationId: (body as Wire.SharedVehicleCreate).operationId, confirmed:true, vehicle: await service.createVehicle(account, body as Wire.SharedVehicleCreate)} satisfies Wire.SharedVehicleCreationReceipt;
            case "sharedVehicleGet": return await service.getVehicle(account, id);
            case "sharedVehicleUpdate": return await service.updateVehicle(account, id, body as Wire.SharedVehicleUpdate);
            case "sharedVehicleMembershipChange": return await service.membership(account, id, body as Wire.SharedVehicleMembershipChange);
            case "sharedVehicleInvite": return await service.createInvitation(account, "vehicle", id, body as Wire.MobilityInvitationCreate);
            case "sharedVehicleInviteRevoke": return await service.revokeInvitation(account, "vehicle", id, body as Wire.MobilityInvitationRevoke);
            case "sharedVehicleInviteAccept": return {operationId:(body as Wire.MobilityInvitationAccept).operationId, confirmed:true, vehicle:await service.acceptInvitation(account, "vehicle", body as Wire.MobilityInvitationAccept)};
            case "sharedVehicleRecordWrite": return await service.writeRecord(account, id, body as Wire.SharedVehicleRecordWrite);
            case "sharedVehicleRecordDelete": return await service.deleteRecord(account, id, body as Wire.SharedVehicleRecordDelete);
            case "sharedVehicleDelete": return await service.deleteVehicle(account, id, body as Wire.SharedVehicleDelete);
            case "sharedVehicleSync": {
              if (Object.keys(query).some(k => !["cursor", "limit"].includes(k)) || (query.cursor?.length ?? 0) > 120 || (query.limit && !/^(?:[1-9][0-9]?|100)$/u.test(query.limit))) throw new MobilityFailure(400, "INVALID_CURSOR", "Neplatné stránkování.");
              return await service.syncVehicle(account, id, query.cursor, query.limit ? Number(query.limit) : 100);
            }
            case "dispatchParticipantConversation": return await openDispatchParticipant(service, options.messagingProvider, account, actor, id, params.accountId!.toLowerCase(), body as Wire.DispatchParticipantOpen);
            case "dispatchCancelStart": return await service.cancelStart(account, body as Wire.DispatchStartCancel);
            case "dispatchOwnedShares": return await service.ownedShares(account);
            case "dispatchGroups": return await service.listGroups(account);
            case "dispatchGroupCreate": return {operationId:(body as Wire.DispatchGroupCreate).operationId, confirmed:true, group:await service.createGroup(account, body as Wire.DispatchGroupCreate)} satisfies Wire.DispatchGroupCreationReceipt;
            case "dispatchGroupGet": return await service.getGroup(account, id);
            case "dispatchMembershipChange": return await service.membershipGroup(account, id, body as Wire.DispatchMembershipChange);
            case "dispatchGroupDelete": return await service.deleteGroup(account, id, body as Wire.DispatchGroupDelete);
            case "dispatchInvite": return await service.createInvitation(account, "group", id, body as Wire.DispatchInvitationCreate);
            case "dispatchInviteRevoke": return await service.revokeInvitation(account, "group", id, body as Wire.MobilityInvitationRevoke);
            case "dispatchInviteAccept": return {operationId:(body as Wire.MobilityInvitationAccept).operationId, confirmed:true, group:await service.acceptInvitation(account, "group", body as Wire.MobilityInvitationAccept)};
            case "dispatchDeviceRegister": return await service.registerDevice(account, body as Wire.DispatchDeviceRegister);
            case "dispatchDeviceRevoke": return await service.revokeDevice(account, body as Wire.DispatchDeviceRevoke);
            case "dispatchReadiness": return await service.readiness(account, id);
            case "dispatchSnapshot": {
              if (Object.keys(query).some(k => k !== "deviceId") || !query.deviceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(query.deviceId)) throw new MobilityFailure(400, "DEVICE_REQUIRED", "Neplatné zařízení.");
              return await service.snapshot(account, id, query.deviceId.toLowerCase());
            }
            case "dispatchStart": return await service.startShare(account, id, body as Wire.DispatchShareStart);
            case "dispatchPublish": return await service.publishPoint(account, id, body as Wire.DispatchPointPublish);
            case "dispatchStop": return await service.stopShare(account, id, body as Wire.DispatchStop);
            default: throw new MobilityFailure(503, "MOBILITY_UNAVAILABLE", "Operace není dostupná.");
          }
          };
          return path.includes("private-dispatch") ? await service.withDispatchLease(options.store!.dispatchGeneration(), execute) : await execute();
        } catch (error) {
          if (error instanceof MobilityFailure) { if (error.retryAfter) reply.header("Retry-After", String(error.retryAfter)); return sendError(reply, error.status, error.code, error.message, correlationId); }
          // Never serialize dependency exceptions, request bodies, keys, identifiers or GPS.
          return sendError(reply, 503, "MOBILITY_UNAVAILABLE", "Sdílení je dočasně nedostupné.", correlationId);
        }
      }
    });
  }
  return () => ({ name: "private-dispatch", status: !options.dispatchEnabled ? "disabled" : options.store!.dispatchIsAvailable() ? "ok" : "unavailable",
    detail: !options.dispatchEnabled ? "disabled" : `exclusive primary lease: ${options.store!.dispatchState()}; generation ${options.store!.dispatchGeneration()}` });
}
