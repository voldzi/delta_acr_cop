/** The bounded pre-start prerequisite of explicit historical enrollment.
 * No issuer is inferred and no existing row is backfilled or reset. These
 * literals must stay byte-normalized equivalent to each actual store's DDL. */
export const legacyErasureColumnsSql = `
ALTER TABLE cop_user_profiles ADD COLUMN IF NOT EXISTS issuer text;
ALTER TABLE cop_user_profiles ADD COLUMN IF NOT EXISTS erasure_fenced boolean NOT NULL DEFAULT false;
ALTER TABLE cop_mobile_devices ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_mobile_mesh_acks ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_mobile_pairing_sessions ADD COLUMN IF NOT EXISTS created_by_owner_issuer text;
ALTER TABLE cop_mobile_pairing_sessions ADD COLUMN IF NOT EXISTS claimed_by_owner_issuer text;
ALTER TABLE cop_voice_calls ADD COLUMN IF NOT EXISTS owner_issuer text;
ALTER TABLE cop_web_sessions ADD COLUMN IF NOT EXISTS owner_hash text;
`;
export const legacyErasureTablesSql = `
CREATE TABLE IF NOT EXISTS cop_user_profile_erasure_fences (
 subject_hash text PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cop_web_session_erasure_fences (
 owner_hash text PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cop_web_session_erasure_metadata (
 id integer PRIMARY KEY CHECK(id=1),
 key_fingerprint text NOT NULL
);
CREATE INDEX IF NOT EXISTS cop_web_sessions_owner_idx ON cop_web_sessions(owner_hash) WHERE owner_hash IS NOT NULL;
`;
