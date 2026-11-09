import type { AuthenticatedActor } from "./security.js";
import type { MessagingConversationSummary } from "./messaging-provider.js";
import { mobilityDigest, MobilityFailure, type PrincipalAccount } from "./mobility-service.js";
import type { SharedMobilityService } from "./mobility-invitations.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function managed(row: MessagingConversationSummary): boolean {
  return row.metadata?.source === "cop.shared_vehicle" || row.conversationId.startsWith("conv_vehicle_") ||
    row.canonicalKey?.startsWith("managed.vehicle/") === true;
}
/** Metadata only. A prepared/invited summary is never a joined receipt. */
export async function currentVehicleConversationMetadata(service: SharedMobilityService | undefined,
  actor: AuthenticatedActor, rows: MessagingConversationSummary[]): Promise<{ conversations: MessagingConversationSummary[]; unavailable: boolean }> {
  if (!rows.some(managed)) return { conversations: rows, unavailable: false };
  const ordinary = rows.filter(row => !managed(row));
  if (!service || actor.authMode !== "oidc" || !actor.issuer) return { conversations: ordinary, unavailable: true };
  try {
    return await service.store.transact([], async tx => {
      const principal = await tx.get<PrincipalAccount>(`identity:${mobilityDigest({ issuer: actor.issuer, subject: actor.subjectId })}`);
      if (!principal || principal.issuer !== actor.issuer || principal.subject !== actor.subjectId)
        return { conversations: ordinary, unavailable: true };
      const registered = await tx.get<PrincipalAccount>(`account:${principal.accountId}`);
      if (!uuid.test(principal.accountId) || registered?.accountId !== principal.accountId ||
          registered.issuer !== actor.issuer || registered.subject !== actor.subjectId)
        return { conversations: ordinary, unavailable: true };
      await service.assertAccountAllowed(tx, principal.accountId);
      const conversations: MessagingConversationSummary[] = [];
      for (const row of rows) {
        if (!managed(row)) { conversations.push(row); continue; }
        const id = row.metadata?.externalId;
        if (row.metadata?.source !== "cop.shared_vehicle" || typeof id !== "string" || !uuid.test(id) ||
            row.conversationId !== `conv_vehicle_${id}` || row.canonicalKey !== `managed.vehicle/${id}`) continue;
        try {
          const state = await service.vehicle(tx, id, principal);
          const projection = state.conversationProjection;
          if (!projection || projection.status === "closed" || projection.sourceMembershipRevision !== state.vehicle.membershipRevision ||
              (projection.binding && (projection.binding.conversationId !== row.conversationId ||
                (row.matrix?.roomId && projection.binding.roomId !== row.matrix.roomId)))) continue;
          conversations.push({ ...row, title: state.vehicle.details.name });
        } catch (error) {
          if (!(error instanceof MobilityFailure) || ![403, 404].includes(error.status)) throw error;
        }
      }
      return { conversations, unavailable: false };
    });
  } catch {
    // An unavailable authority cannot leak stale managed metadata. Ordinary
    // conversations remain available; callers expose the existing degraded state.
    return { conversations: ordinary, unavailable: true };
  }
}
