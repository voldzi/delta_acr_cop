import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresUserProfileStore, userAvatarRevision } from "./user-profile-store.js";
const connectionString=process.env.COP_PROFILE_TEST_DATABASE_URL;
if(connectionString){const url=new URL(connectionString);if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/cop_profile_test")throw Error("Requires isolated loopback cop_profile_test database")}
describe.skipIf(!connectionString)("real PostgreSQL canonical avatar",()=>{
 it("atomically creates/updates, rejects stale owner revisions and preserves preferences across restart",async()=>{
  const first=new PostgresUserProfileStore({connectionString,max:3});const second=new PostgresUserProfileStore({connectionString,max:3});const admin=new Pool({connectionString});
  const a={subjectId:"synthetic-"+randomUUID(),displayName:"Synthetic",username:"Synthetic"};const b={...a,subjectId:"synthetic-"+randomUUID()};
  try{
   await first.init();await second.init();expect(await first.getProfile(a.subjectId)).toBeNull();
   const initial=userAvatarRevision(a.subjectId,null);
   const writes=await Promise.all([first,second].map(s=>s.updateAvatar(a,"data:image/png;base64,c3ludGhldGlj",initial)));expect(writes.filter(Boolean)).toHaveLength(1);
   const saved=writes.find(Boolean)!;expect(await first.updateAvatar(b,null,userAvatarRevision(a.subjectId,saved))).toBeNull();expect(await first.getProfile(b.subjectId)).toBeNull();
   await first.upsertProfile({...a,preferences:{...saved.preferences,operatorProfile:{...(saved.preferences.operatorProfile as object),organization:"Synthetic"},theme:"dark"},alertPreferences:{minimumSeverity:"warning"}});
   const before=(await second.getProfile(a.subjectId))!;
   const outcomes=await Promise.all([first,second].map(s=>s.updateAvatar(a,null,userAvatarRevision(a.subjectId,before))));expect(outcomes.filter(Boolean)).toHaveLength(1);
   const updated=outcomes.find(Boolean)!;expect(updated.preferences).toMatchObject({theme:"dark",operatorProfile:{organization:"Synthetic"}});expect(updated.alertPreferences).toEqual(before.alertPreferences);expect(userAvatarRevision(a.subjectId,updated)).not.toBe(userAvatarRevision(a.subjectId,before));
   const reopened=new PostgresUserProfileStore({connectionString});try{await reopened.init();expect(await reopened.getProfile(a.subjectId)).toEqual(updated)}finally{await reopened.close()}
  }finally{await admin.query("DELETE FROM cop_user_profiles WHERE subject_id=ANY($1::text[])",[[a.subjectId,b.subjectId]]);await admin.end();await first.close();await second.close()}
 });
});
