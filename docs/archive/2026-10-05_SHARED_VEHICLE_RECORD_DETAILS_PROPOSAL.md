# Shared vehicle record details: reviewed proposal

Status2026-10-05: proposal only, no implementation, SDK publication, capability activation or production deployment. Existing binding `openapi/openapi.json` and shared-mobility fragment remain unchanged. This document becomes binding only after coordinated JSON/SDK/server implementation and acceptance.

## User requirement and existing source

A shared vehicle belongs in the normal Vehicles list, alongside private vehicles, using the same FuelRecordEditView, ChargingRecordEditView and ServiceRecordEditView. Storage target determines local/private versus authenticated COP shared storage; permissions disable unavailable actions. Do not create duplicate SwiftData vehicles or a second simplified form.

Current Energy payload supports unit/quantity/amount; Service supports title/odometerKm/amount. Jízda fields are richer, so the current contract cannot losslessly save those forms. Source inspection: current CSMSharedVehicleRecordDataEnergy/Service, COP shared-mobility JSON, FuelRecord/ServiceRecord and Jízda's integration confirmation. No real data inspected or altered.

## Exact additive DTO proposal

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

No live GPS, latitude/longitude, location accuracy/source, inferred ride location or home coordinate is added to these records. Precise location control must be visibly disabled for shared storage, with an explanation; do not silently discard coordinates from the identical form. A person may explicitly select a station/place name/address snapshot to share. Live and encrypted Dispatch location have a separate consent and contract. New receipt notes/address never become implicit AI or public-map context.

## Proposed synthetic examples (not actual server responses)

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

## Implementation / acceptance handoff

1. COP JSON contract and fragment, generated TypeScript/Swift DTOs, explicit capabilities and semantic validation, bounded payloads. No capability claim in current production.
2. Persistence readback/restart, receipt-level atomicity, operation retry/idempotency, two-account/role isolation, readCosts filtering, stale revisions, omission/unknown-version guards, all fields and explicit removals preserved. Tests use synthetic text/stations/items, never real accounts or GPS.
3. Jízda reuses existing forms with storage target and read-only/disabled role UX. Same validation across local/shared amounts, visible length/unit limits, no local record duplication or partial receipt saving. Ordinary vehicle list combines local models and remote identities without manufacturing duplicate storage.
4. Joint acceptance on authorized phones; only then necessary scoped backend/SDK publication and production delivery under the applicable human authorization. Successful receipt acceptance does not prove navigation or traffic benefit.

Unrelated caller/membership fixes remain separately awaiting human approval. This proposal performs no network, credential, account, vehicle, record, GPS or production mutation.
