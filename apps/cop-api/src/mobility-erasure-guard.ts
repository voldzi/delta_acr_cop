import { createHash } from "node:crypto";
import type { MobilityTransaction } from "./mobility-store.js";

/** Same canonical issuer/subject binding as MobilityService.account; never an email/name match. */
export function mobilityIdentityDigest(issuer: string, subject: string): string {
  return createHash("sha256").update(JSON.stringify({ issuer, subject })).digest("hex");
}
export const mobilityIdentityFenceKey = (identity: string): string => `mobility-erasure:identity:${identity}`;
export const mobilityAccountFenceKey = (accountId: string): string => `mobility-erasure:account:${accountId}`;

export async function mobilityAccountIsFenced(tx: MobilityTransaction, accountId: string): Promise<boolean> {
  return !!await tx.get(mobilityAccountFenceKey(accountId));
}
