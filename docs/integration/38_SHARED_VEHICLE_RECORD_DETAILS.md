# Shared vehicle record details v1: contract and handoff

Status2026-10-05: published SDK and COP code; API-only production delivery completed at15:59:16UTC. Binding JSON: `openapi/openapi.json` and `docs/api/shared-mobility-v1.openapi.json`. Authenticated detail capability was verified with synthetic OIDC in the exact release image; production runtime artifacts and availability verified read-only. Real phone receipt acceptance remains separate.

## User requirement and existing source

A shared vehicle belongs in the normal Vehicles list, alongside private vehicles, using the same FuelRecordEditView, ChargingRecordEditView and ServiceRecordEditView. Storage target determines local/private versus authenticated COP shared storage; permissions disable unavailable actions. Do not create duplicate SwiftData vehicles or a second simplified form.

Current Energy payload supports unit/quantity/amount; Service supports title/odometerKm/amount. Jízda fields are richer, so the current contract cannot losslessly save those forms. Source inspection: current CSMSharedVehicleRecordDataEnergy/Service, COP shared-mobility JSON, FuelRecord/ServiceRecord and Jízda's integration confirmation. No real data inspected or altered.

## Exact additive DTO

All existing required fields and envelope operationId,recordId,expectedRecordRevision,expectedDataRevision,expectedMembershipRevision,occurredAt,timeZone remain unchanged. Optional omitted values mean unknown/absent, never default zero/false. No null values or arbitrary free-form extension dictionary. Additional properties false for every new object.

| JSON / public SDK DTO | Fields |
| --- | --- |
| Capabilities (existing CSMMobilityCapabilities) | optional recordDetailsVersions:[Int], recordEnergyUnits:[String], supportedRefuelingFuelTypes:[String] |
| Energy (existing CSMSharedVehicleRecordDataEnergy) | optional details:CSMSharedVehicleEnergyDetails |
| CSMSharedVehicleEnergyDetails | version:Int(const1), kind:refueling\|charging, odometerKm:String?, note:String?, refueling:CSMSharedVehicleRefuelingDetails?, charging:CSMSharedVehicleChargingDetails? |
| CSMSharedVehicleRefuelingDetails | fuelType:String?, fullTank:Bool?, quantityBeforeRefueling:String?, station:CSMSharedVehicleStationSnapshot? |
| CSMSharedVehicleStationSnapshot | name:String?, provider:String?, address:String? |
| CSMSharedVehicleChargingDetails | source:home\|publicAC\|publicDC\|workplace\|other?, provider:String?, locationName:String?, location:CSMSharedVehicleStationSnapshot?, batteryPercentBefore:String?, batteryPercentAfter:String? |
| Service (existing CSMSharedVehicleRecordDataService) | optional details:CSMSharedVehicleServiceDetails |
| CSMSharedVehicleServiceDetails | version:Int(const1), note:String?, categoryId:String?, subcategoryId:String?, items:[CSMSharedVehicleServiceItem]? |
| CSMSharedVehicleServiceItem | itemId:UUID, title:String, categoryId:String?, subcategoryId:String?, amount:CSMSharedVehicleMoney |

Version/kind required in Energy details; exactly one matching refueling/charging object required, the other prohibited. Liters pair with refueling; kWh with charging. Service details require version; supplied item array has1..100 entries with unique itemId. Existing summary title max120 unchanged; detailed item titles max160, nonempty. If a descriptive summary does not fit120, use a derived generic summary rather than discard the actual item titles, which remain in details.

New note max1000Unicode code points, visible validation, never trim/truncate. Station name/provider/locationName and charging provider max160; address max500; category/subcategory identifiers max80. Empty note explicitly clears; omitted note is absent in the complete replacement details. Station snapshot contains selected name/brand as provider/address, never a local SwiftData UUID.

Reuse existing decimal pattern `^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$` for kilometers/quantity, no floats on wire. Battery decimal percent0..100,maximum3fractional digits; validate after≥before for a new charging receipt when both known. Money stays existing `currency:CZK|EUR|USD`, `minorUnits:^(0|[1-9][0-9]{0,11})$`. Exact arithmetic, no conversion through binary floating point.

Fuel types supported by this liters form: natural95,natural98,natural100,diesel,`diesel plus`,lpg,bioEthanol. Unknown old records retain unknown type. CNG/hydrogen cannot be written as liters by this new form; show explicit unsupported-unit reason and reject a supplied cng/hydrogen with422 UNSUPPORTED_ENERGY_UNIT. Do not invent conversion from kg/m3 to liters. Adding kg/m3 to the v1 unit enum would break older generated readers; later real mass/volume-unit support needs a coordinated versioned read/write contract, not an implicit enum extension.

## Financial semantics

ServiceRecordEditView supplies one receipt with a total calculated by exact sum of all service item costs. With details.items present, each amount has the same currency as the record total, the total must exist and must equal the exact minor-unit sum. Reject new mismatches422 RECEIPT_TOTAL_MISMATCH. Do not record each item as another expense or add total and breakdown. Read legacy records lacking details with their stored total and no invented items; an explicit migration/read-only legacy inconsistency state is required before converting a mismatched historical receipt.

One operation creates/updates one complete receipt (energy or service) atomically. Retried operationId returns the original receipt; a changed request under the same id is a conflict. Preserve existing account/vehicle/cost ACL, revision conflicts, deletion/audit/retention behavior. No automatic transfer of private records into shared storage.

## Capability and editing safety

Server may advertise `recordDetailsVersions:[1]`, `recordEnergyUnits:["liters","kWh"]` and the supported liquid fuel types only after validated write/readback and persistence work. Missing capability is unsupported/unknown; host must disable lossless shared-form save with an explanation. Availability is separate from capability and role permission.

Older detail-free clients keep their existing create/update behavior on detail-free records. If a stored record already contains details and the submitted replacement omits details, return409 DETAILS_VERSION_REQUIRED without changes. Never silently erase existing details. A supporting client submits a complete versioned details object; explicit field removal is represented by omitting the property in this confirmed complete object (empty note also supported). Unknown detail version: read-only display of known summary, no edit/save fallback. Deletion remains its existing explicit tombstone operation with permission/revision checks.

## Location handling

No live GPS, latitude/longitude, location accuracy/source, inferred ride location or home coordinate is added to these records. Precise location control must be visibly disabled for shared storage, with an explanation; do not silently discard coordinates from the identical form. A person may explicitly select a station/place name/address snapshot to share. Live and encrypted Dispatch location have a separate consent and contract. New receipt notes/address are vehicle-scoped fields. This release does not add them to any AI or public-map context.

## Synthetic contract fixtures (not production user responses)

```json
{
  "kind":"energy", "unit":"liters", "quantity":"40.5",
  "amount":{"currency":"CZK","minorUnits":"162000"},
  "details":{"version":1,"kind":"refueling","odometerKm":"123456.7","note":"Synthetic test receipt",
    "refueling":{"fuelType":"natural95","fullTank":true,"quantityBeforeRefueling":"5",
      "station":{"name":"Synthetic station","provider":"Synthetic provider","address":"Synthetic address"}}}
}
```

```json
{
  "kind":"service","title":"Servis","odometerKm":"123456.7",
  "amount":{"currency":"CZK","minorUnits":"300000"},
  "details":{"version":1,"note":"Synthetic receipt",
    "items":[
      {"itemId":"00000000-0000-4000-8000-000000000001","title":"Synthetic work","amount":{"currency":"CZK","minorUnits":"100000"}},
      {"itemId":"00000000-0000-4000-8000-000000000002","title":"Synthetic part","amount":{"currency":"CZK","minorUnits":"200000"}}
    ]}
}
```

## Integration / acceptance handoff

1. COP JSON contract and fragment, generated TypeScript/Swift DTOs, explicit capabilities and semantic validation, bounded payloads. Exact release image advertises version1; production runtime artifact hash matches it.
2. Persistence readback/restart, receipt-level atomicity, operation retry/idempotency, two-account/role isolation, readCosts filtering, stale revisions, omission/unknown-version guards, all fields and explicit removals preserved. Tests use synthetic text/stations/items, never real accounts or GPS.
3. Jízda reuses existing forms with storage target and read-only/disabled role UX. Same validation across local/shared amounts, visible length/unit limits, no local record duplication or partial receipt saving. Ordinary vehicle list combines local models and remote identities without manufacturing duplicate storage.
4. Joint acceptance on authorized phones remains separate from the scoped backend/SDK publication and production delivery authorized for these shared forms. Successful receipt acceptance does not prove navigation or traffic benefit.

Unrelated caller/membership fixes remain separately awaiting human approval. No real user data, GPS, account or vehicle was created/changed for tests.

## Verification evidence

-23targetedserverchecks pass (5new lossless receipt boundaries plus existing18mobility/HTTPchecks). Entire COP1301pass/5skip; lint/typecheck/APIbuild pass, OpenAPIvalid26existingwarnings,11schemas validated,skeletonpass.
-Real isolated PostgreSQL receipt test passes: full detail readback, persisted idempotent receipt after separateconnection/service restart, omission409no revisionchange, two concurrent writers one winner. Ephemeral loopbackdatabase removed afterward.
-SDK4new tests verify all typed fields, one service receipt with items, old payloads/capabilityunknown and unsupportedversionread-only detection, explicit charging place/battery. Mandatory full SDK gate rerun on explicit COP iPhoneDuo:30appunit,5appUI,118packageXCTest(1skip),2SwiftTesting,2accessibility audits; all gates PASS on explicit COP iPhoneDuo (101C6F6D-5BD8-41EC-8183-9EBED780FDD7).
-An initial automatic simulator choice picked another application's QA device; UI tests failed there and its result writer stalled. No product correction inferred from this. Own failed test stopped; original tests restored unchanged and rerun on explicit previously verified COP simulator. These failed attempts are not acceptance evidence.
-Physical Jízda form/roles/save/readback/offline acceptance remains separate; no actual signed-in receipt sent for automation.

## Delivery

- SDK implementation/public pin: `98d1c383ec024f98ba501dfebd954354bd2b1b64`, branch `codex/shared-mobility-sdk` (COP-Mobile). Clean commit archive: four new tests PASS.
- COP implementation/public pin: `1dfe394ca12849ca5f4df4fb61336d99ccf27a4f`, branch `codex/shared-vehicle-record-details`.
- Binding JSON SHA256: `ebb7f3d299149d67679e816511577ee0146f951cb18e0ebccef10fc74616be42`.
- Mobility fragment SHA256: `44c79634dee5ebea21e2f941c53165c79359166050946c235f471f2fa80441c9`.
- Receipt-release API image (superseded by the snapshot release inhandoff39): `sha256:1539f6813a70650dc0d2e520d7c68c7ca75322c50f7675d829747ad852c4c05e`, tag `delta-acr-cop-api:record-details-1dfe394`, started2026-10-05T15:59:16.630196293Z. Configuration/secrets/compose unchanged;134other container identities unchanged. SIM/Messaging/web unaffected.
- Tested compatibility rollback: `sha256:cea34e9fa9fbbeb4c6e707110ec9a3a791542573c6538f360201bf89bb6b07ff`, tag `delta-acr-cop-api:record-details-safe-rollback-20261005`. Previous self-profile image plus only a guard rejecting edits of existing detailed records409. Does not advertise new details capability. Do not substitute an unguarded older image, which could erase details.
- Both exact images passed isolated network-none synthetic signed OIDC HTTP checks: two-account isolation, capability, complete single receipt readback, persisted retry, omission409/no mutation. Release also rejects bad total422 and unknown/GPS fields400.446release artifact hashes match running production; rollback guard hash verified separately.
- Production read-only at16:00:30UTC: three health200, six anonymous boundary requests401, primary PostgreSQL, one dedicated Dispatch lease ready/generation1. Measurementsfalse/sharedMobilitytrue/Dispatchtrue unchanged. No signed-in real receipt, account, member or GPS was changed for proof.
- Evidence host: `/home/voldzi/cop-deployments/shared-record-details-20261005/`. Existing phone clients can read known summaries, but must be disabled for editing detailed records until the supporting SDK is integrated. Keep production data unchanged during acceptance.


## Explicit remaining odometer boundary

This receipt release retains Energy.details.odometerKm and Service.odometerKm as part of the single atomic receipt. That receipt-only release did not provide an authoritative current shared odometer snapshot independent of sync pagination and readCosts; the separately delivered [snapshot contract39](39_SHARED_VEHICLE_ODOMETER_SNAPSHOT.md) now adds that projection. Energy/service records remain entirely hidden from members without readCosts. Clients must not derive or claim shared current kilometers from a partial event page or overwrite personal CloudKit history. Use the separate version/capability/revision gates fromhandoff39; receipt-only versions still cannot meet that requirement.
