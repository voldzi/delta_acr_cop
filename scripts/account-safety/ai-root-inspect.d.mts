export interface AiCheckpointRequest {
  readonly owner: "sim_ai_router";
  readonly scope: "cop_router_primary_database";
  readonly purpose: "checkpoint";
  readonly expectedSnapshot: { readonly checkpointId: string; readonly generation: string; readonly operationDigest: string; readonly schemaDigest: string };
}
export interface AiCheckpointAdmission {
  readonly contractVersion: "sim-ai-router-checkpoint-admission-v1";
  readonly request: AiCheckpointRequest;
  readonly reference: { readonly recordId: string; readonly digest: string };
}
/** Current signed Root evidence over actual kernel-peer transport; no injected
 * callback, app-selected permit, user, key, URL, credential or SQL. */
export function createProductionAiCheckpointAdmissionPort(): { inspect(request: AiCheckpointRequest): Promise<AiCheckpointAdmission | undefined> };
