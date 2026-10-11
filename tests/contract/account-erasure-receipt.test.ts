import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAjv } from "../../packages/ingest-contracts/src/index.js";
const openapi=JSON.parse(readFileSync(new URL("../../openapi/openapi.json",import.meta.url),"utf8"));
const components={schemas:{AccountErasureReceipt:openapi.components.schemas.AccountErasureReceipt,
  AccountErasureRequest:openapi.components.schemas.AccountErasureRequest,AccountErasureCapabilities:openapi.components.schemas.AccountErasureCapabilities}};
const compile=(schema:Record<string,unknown>)=>createAjv().compile({...schema,components});
const pending={contractVersion:"cop-account-erasure-v1",operationId:"24c37f84-62d6-4b65-9c62-f2dcb17c349d",
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
      {...pending,accountDeleted:true},{...pending,subjectId:"another-user"}])expect(validate(value)).toBe(false);
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
  });
});
