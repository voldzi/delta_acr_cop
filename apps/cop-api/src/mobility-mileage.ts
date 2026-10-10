import { acceptsMobilitySchema } from "./mobility-contract.js";
import { sharedOdometerSnapshot } from "./mobility-odometer.js";
import type { VehicleState } from "./mobility-service.js";
import type * as W from "./mobility-types.js";
const units=(value:string):bigint=>{const [whole,fraction=""]=value.split(".");return BigInt(whole!)*1000n+BigInt(fraction.padEnd(3,"0"))};
const decimal=(value:bigint):string=>{const whole=value/1000n;const remainder=(value%1000n).toString().padStart(3,"0").replace(/0+$/u,"");return whole.toString()+(remainder?"."+remainder:"")};
const validInterval=(data:Extract<W.SharedVehicleRecordData,{kind:"ride_summary"}>,now:Date):boolean=>{
 if(!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/u.test(data.distanceKm)||!Number.isSafeInteger(data.durationSeconds)||data.durationSeconds<0)return false;
 const detail=data.details;if(!detail||!acceptsMobilitySchema("SharedVehicleRideDetails",detail))return false;
 const start=Date.parse(detail.startedAt),end=Date.parse(detail.endedAt);
 return start<end && end<=now.getTime()+300000 && data.durationSeconds<=Math.ceil((end-start)/1000)+5;
};
export function sharedOdometerSnapshotV2(state:VehicleState,now:Date):W.SharedVehicleOdometerSnapshotV2 {
 const base={version:2 as const,dataRevision:state.vehicle.dataRevision};
 const review=(reason:W.SharedVehicleOdometerSnapshotV2["reason"]):W.SharedVehicleOdometerSnapshotV2=>({...base,status:"reviewRequired",reason});
 const active=Object.values(state.records).filter(record=>!record.deleted);
 const rides=active.filter((r):r is W.SharedVehicleRecord & {data:Extract<W.SharedVehicleRecordData,{kind:"ride_summary"}>}=>r.data.kind==="ride_summary");
 const seen=new Set<string>();const records={...state.records};
 for(const ride of rides){
  if(!ride.data.details)continue;
  if(ride.vehicleId!==state.vehicle.vehicleId||!validInterval(ride.data,now))return review("invalid_ride_interval");
  const tripId=ride.data.details.tripId.toLowerCase();if(seen.has(tripId))return review("duplicate_trip");seen.add(tripId);
  if(ride.data.details.endOdometerKm!==undefined)records[ride.recordId]={...ride,occurredAt:ride.data.details.endedAt,data:{kind:"odometer",odometerKm:ride.data.details.endOdometerKm}};
 }
 const reading=sharedOdometerSnapshot({...state,records},now);
 if(reading.status!=="known")return{...base,status:reading.status,reason:reading.reason};
 const source={...reading.source!,recordKind:state.records[reading.source!.recordId]!.data.kind as W.SharedVehicleMileageSource["recordKind"]};
 const anchor=Date.parse(reading.observedAt!);
 const later:Array<{record:typeof rides[number];start:number;end:number}> = [];
 for(const ride of rides){
  const detail=ride.data.details;
  if(!detail){if(Date.parse(ride.occurredAt)>anchor)return review("legacy_ride_interval_unknown");continue;}
  const start=Date.parse(detail.startedAt),end=Date.parse(detail.endedAt);
  if(end<=anchor)continue;
  if(start<anchor)return review("anchor_overlap");
  later.push({record:ride,start,end});
 }
 later.sort((a,b)=>a.start-b.start||a.end-b.end||a.record.recordId.localeCompare(b.record.recordId,"en"));
 let distance=0n;
 for(let i=0;i<later.length;i++){
  const ride=later[i]!;if(i&&ride.start<later[i-1]!.end)return review("overlapping_rides");
  distance+=units(ride.record.data.distanceKm);
 }
 if(!later.length)return{...base,status:"known",valueKm:reading.valueKm,observedAt:reading.observedAt,source};
 const value=units(reading.valueKm!)+distance;if(value>999999999999n || distance>999999999999n)return review("distance_overflow");
 return{...base,status:"estimated",valueKm:decimal(value),observedAt:later.at(-1)!.record.data.details!.endedAt,
  basisKm:reading.valueKm,basisObservedAt:reading.observedAt,basisSource:source,includedRideCount:later.length,unconfirmedDistanceKm:decimal(distance)};
}
export function sharedMileageViews(state:VehicleState,now:Date):{odometerSnapshot:W.SharedVehicleOdometerSnapshot;odometerSnapshotV2:W.SharedVehicleOdometerSnapshotV2}{
 const v2=sharedOdometerSnapshotV2(state,now);const v1=sharedOdometerSnapshot(state,now);
 const incompatible=v2.status==="estimated"||v2.status==="reviewRequired"||(v2.status==="known"&&v2.source?.recordKind==="ride_summary");
 return{odometerSnapshot:incompatible?{version:1,status:"reviewRequired",dataRevision:state.vehicle.dataRevision}:v1,odometerSnapshotV2:v2};
}
export function validateSharedRideRecord(state:VehicleState,recordId:string,data:W.SharedVehicleRecordData,now:Date):{code:string;message:string}|undefined{
 if(data.kind==="odometer"&&data.initial){
  const projection=sharedOdometerSnapshotV2(state,now);
  const hasReading=Object.values(state.records).some(r=>!r.deleted&&(r.data.kind==="odometer"||(r.data.kind==="service"&&r.data.odometerKm!==undefined)||(r.data.kind==="energy"&&r.data.details?.odometerKm!==undefined)||(r.data.kind==="ride_summary"&&r.data.details?.endOdometerKm!==undefined)));
  if(hasReading||projection.status==="known"||projection.status==="estimated")return{code:"INITIAL_ODOMETER_EXISTS",message:"Společný stav již existuje. Obnovte vozidlo; počáteční odečet nelze znovu založit."};
 }
 if(data.kind!=="ride_summary"||!data.details)return;
 const previous=state.records[recordId];
 if(previous?.data.kind==="ride_summary"&&previous.data.details&&previous.data.details.tripId.toLowerCase()!==data.details.tripId.toLowerCase())return{code:"RIDE_ID_IMMUTABLE",message:"Identitu dokončené jízdy nelze změnit."};
 if(!validInterval(data,now))return{code:"INVALID_RIDE_INTERVAL",message:"Souhrn vyžaduje skutečný platný začátek a konec dokončené jízdy."};
 if(Object.values(state.records).some(r=>r.recordId!==recordId&&r.data.kind==="ride_summary"&&r.data.details?.tripId.toLowerCase()===data.details!.tripId.toLowerCase()))return{code:"DUPLICATE_RIDE_ID",message:"Tato jízda již má společný záznam. Použijte jeho původní identitu a revizi."};
}
