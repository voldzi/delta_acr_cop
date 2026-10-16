-- Explicit administrator migration on the existing independent guard DB.
-- No credentials, enrollment, deletion, or runtime INSERT/UPDATE/DELETE grant.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database()<>'cop_account_safety_guard' THEN RAISE EXCEPTION 'wrong_database'; END IF;
END $$;
CREATE TABLE cop_safety_v2.media_upload_closures (
  bucket text NOT NULL CHECK(bucket='cop-community-media'),
  application_store_id uuid NOT NULL,
  incarnation_id uuid NOT NULL,
  restore_generation bigint NOT NULL CHECK(restore_generation>0),
  endpoint text NOT NULL,
  credential_fingerprint text NOT NULL CHECK(credential_fingerprint ~ '^[a-f0-9]{64}$'),
  previous_credential_fingerprint text NOT NULL CHECK(previous_credential_fingerprint ~ '^[a-f0-9]{64}$' AND previous_credential_fingerprint<>credential_fingerprint),
  provider_image_id text NOT NULL CHECK(provider_image_id ~ '^sha256:[a-f0-9]{64}$'),
  provider_stopped_at timestamptz NOT NULL,
  provider_restarted_at timestamptz NOT NULL CHECK(provider_restarted_at>provider_stopped_at),
  old_credential_denied_at timestamptz NOT NULL CHECK(old_credential_denied_at>=provider_restarted_at),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(bucket,application_store_id,incarnation_id,restore_generation,credential_fingerprint)
);
CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON cop_safety_v2.media_upload_closures FOR EACH ROW EXECUTE FUNCTION cop_safety_v2.immutable();
CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON cop_safety_v2.media_upload_closures FOR EACH STATEMENT EXECUTE FUNCTION cop_safety_v2.immutable();
REVOKE ALL ON cop_safety_v2.media_upload_closures FROM PUBLIC;
GRANT SELECT ON cop_safety_v2.media_upload_closures TO cop_safety_v2_runtime;
COMMIT;
