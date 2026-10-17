import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAjv } from "../../packages/ingest-contracts/src/index.js";
const openapi=JSON.parse(readFileSync(new URL("../../openapi/openapi.json",import.meta.url),"utf8"));
const components={schemas:{AccountErasureReceipt:openapi.components.schemas.AccountErasureReceipt,
  AccountErasureRequest:openapi.components.schemas.AccountErasureRequest,AccountErasureCapabilities:openapi.components.schemas.AccountErasureCapabilities, AccountErasurePreflight:openapi.components.schemas.AccountErasurePreflight,
  AccountErasureOwnerReadiness:openapi.components.schemas.AccountErasureOwnerReadiness}};
const compile=(schema:Record<string,unknown>)=>createAjv().compile({...schema,components});
const pending={contractVersion:"cop-account-erasure-v1",deletionScope:"cop_jizda_preserve_shared_identity_sim",operationId:"24c37f84-62d6-4b65-9c62-f2dcb17c349d",
  status:"deleting",requestedAt:"2026-10-11T00:00:00Z",accountDeleted:false,revocationEnforced:true,
  remaining:["sim_measurements"],pendingReasons:{sim_measurements:"cleanup_pending"}};
const completed={...pending,status:"deleted",accountDeleted:true,remaining:[],pendingReasons:{},completedAt:"2026-10-11T00:05:00Z"};
describe("whole COP erasure binding contract",()=>{
  it("ties status, terminal timestamp and pending owners to truthful completion",()=>{
    const validate=compile({$ref:"#/components/schemas/AccountErasureReceipt"});
    for(const value of [pending,completed])expect(validate(value)).toBe(true);
    for(const value of [{...pending,remaining:[]},{...completed,remaining:["sim_measurements"]},
      {...pending,completedAt:completed.completedAt},{...completed,completedAt:undefined},
      {...pending,remaining:["unknown"]},{...pending,remaining:["sim_measurements","sim_measurements"]},
      {...pending,accountDeleted:true},{...pending,deletionScope:undefined},{...completed,deletionScope:"shared_identity_deleted"},{...pending,subjectId:"another-user"}])expect(validate(value)).toBe(false);
  });
  it("accepts POST200 only for deleted and POST202 only for pending",()=>{
    const responses=openapi.paths["/api/v1/me/account-deletion"].post.responses;
    const success=compile(responses["200"].content["application/json"].schema);
    const accepted=compile(responses["202"].content["application/json"].schema);
    expect(success(completed)).toBe(true);expect(success(pending)).toBe(false);
    expect(accepted(pending)).toBe(true);expect(accepted(completed)).toBe(false);
  });
  it("requires the separate explicit whole-account confirmation and no caller identity",()=>{
    const validate=compile({$ref:"#/components/schemas/AccountErasureRequest"});
    expect(validate({confirmAccountDeletion:true})).toBe(true);
    for(const value of [{},{confirmAccountDeletion:false},{confirmAccountDeletion:true,subjectId:"another"},{scope:"jizda_app_link"}])expect(validate(value)).toBe(false);
  });
  it("never publishes ready capability with an unavailable reason or disabled capability without reason",()=>{
    const validate=compile({$ref:"#/components/schemas/AccountErasureCapabilities"});
    expect(validate({contractVersion:"cop-account-erasure-v1",accountDeletion:false,unavailableReason:"required_adapters_missing"})).toBe(true);
    expect(validate({contractVersion:"cop-account-erasure-v1",accountDeletion:true})).toBe(true);
    expect(validate({contractVersion:"cop-account-erasure-v1",accountDeletion:false})).toBe(false);
    expect(validate({contractVersion:"cop-account-erasure-v1",accountDeletion:true,unavailableReason:"not_enabled"})).toBe(false);
    const ownerReadiness={contractVersion:"cop-account-erasure-owner-readiness-v1",ready:true,checkedAt:"2026-10-16T12:00:00Z"};
    const disabled={contractVersion:"cop-account-erasure-v1",accountDeletion:false,unavailableReason:"not_accepted",ownerReadiness};
    expect(validate(disabled)).toBe(true);
    for(const bad of [{...ownerReadiness,unavailableReason:"adapter_unavailable"},{...ownerReadiness,ready:false},
      {...ownerReadiness,checkedAt:"unknown"},{...ownerReadiness,accountId:"not-public"}])expect(validate({...disabled,ownerReadiness:bad})).toBe(false);
    expect(validate({...disabled,ownerReadiness:{...ownerReadiness,ready:false,unavailableReason:"adapter_unavailable"}})).toBe(true);
  });
});

describe("preflight and independent receipt capability contract",()=>{
  it("requires a complete server plan only for an unblocked preflight and never a JSON capability",()=>{
    const validate=compile({$ref:"#/components/schemas/AccountErasurePreflight"});
    const ready={contractVersion:"cop-account-erasure-preflight-v1",deletionScope:"cop_jizda_preserve_shared_identity_sim",operationId:pending.operationId,canConfirm:true,planId:pending.operationId,confirmBy:"2026-10-13T12:05:00Z",blockers:[]};
    const blocked={contractVersion:"cop-account-erasure-preflight-v1",deletionScope:"cop_jizda_preserve_shared_identity_sim",operationId:pending.operationId,canConfirm:false,blockers:[{domain:"cop_sessions_profiles",reason:"ownership_unresolved"}]};
    expect(validate(ready)).toBe(true);expect(validate(blocked)).toBe(true);
    for(const value of [{...ready,planId:undefined},{...ready,deletionScope:undefined},{...ready,deletionScope:"shared_identity_deleted"},{...ready,blockers:blocked.blockers},{...blocked,planId:pending.operationId},{...ready,capability:"must-not-be-json"},{...blocked,blockers:[]}])expect(validate(value)).toBe(false);
  });
  it("reserves capability authority to the dedicated GET and retains strict v1 receipt",()=>{
    const tracking=openapi.paths["/api/v1/me/account-deletion/receipts/{operationId}"].get;
    expect(tracking.security).toEqual([{erasureReceiptHeader:[]},{erasureReceiptCookie:[]}]);
    expect(tracking.responses["200"].content["application/json"].schema).toEqual({$ref:"#/components/schemas/AccountErasureReceipt"});
    expect(openapi.paths["/api/v1/me/account-deletion"].post.security).toEqual([{bearerAuth:[]}]);
  });
});


describe("shared identity v2 is explicit and cannot reuse v1 meaning", () => {
  it("accepts only matching contract and deletion scope pairs", () => {
    const validate = compile({ $ref: "#/components/schemas/AccountErasureReceipt" });
    const shared = { ...pending, contractVersion: "cop-account-erasure-v2", deletionScope: "cop_sim_shared_identity_v1" };
    expect(validate(shared)).toBe(true);
    expect(validate({ ...shared, contractVersion: "cop-account-erasure-v1" })).toBe(false);
    expect(validate({ ...pending, contractVersion: "cop-account-erasure-v2" })).toBe(false);
  });
});
