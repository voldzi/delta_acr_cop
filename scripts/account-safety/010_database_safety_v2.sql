-- Explicit administrator migration. No enrollment, LOGINs, credentials or
-- changes to the earlier cop_guard schema. Apply only to the independent DB.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_database() <> 'cop_account_safety_guard' THEN RAISE EXCEPTION 'wrong_database'; END IF;
END $$;
CREATE SCHEMA cop_safety_v2;
REVOKE ALL ON SCHEMA cop_safety_v2 FROM PUBLIC;
CREATE TABLE cop_safety_v2.configuration (
  singleton boolean PRIMARY KEY CHECK(singleton),
  contract_version text NOT NULL CHECK(contract_version = 'cop-database-safety-v2'),
  guard_store_id uuid NOT NULL,
  application_store_id uuid NOT NULL,
  configuration_fingerprint text NOT NULL CHECK(configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  initial_digest text NOT NULL CHECK(initial_digest ~ '^[0-9a-f]{64}$'),
  -- Explicit existing-alias/key-history review, never an automatically enrolled
  -- boolean. Contains fingerprints and evidence digest, never secret values.
  identity_binding jsonb CHECK(identity_binding IS NULL OR jsonb_typeof(identity_binding)='object')
);
CREATE TABLE cop_safety_v2.fences (
  sequence bigint PRIMARY KEY CHECK(sequence > 0),
  account_key text NOT NULL UNIQUE CHECK(account_key ~ '^[0-9a-f]{64}$'),
  operation_id uuid NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL,
  entry jsonb NOT NULL CHECK(jsonb_typeof(entry) = 'object' AND octet_length(entry::text) <= 16384),
  previous_digest text NOT NULL CHECK(previous_digest ~ '^[0-9a-f]{64}$'),
  digest text NOT NULL UNIQUE CHECK(digest ~ '^[0-9a-f]{64}$')
);
CREATE TABLE cop_safety_v2.dataset_replays (
  owner text PRIMARY KEY CHECK(owner = 'cop'),
  store_id uuid NOT NULL,
  incarnation_id uuid NOT NULL,
  restore_generation bigint NOT NULL CHECK(restore_generation > 0),
  replay_sequence bigint NOT NULL CHECK(replay_sequence >= 0),
  replay_digest text NOT NULL CHECK(replay_digest ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION cop_safety_v2.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable_safety_evidence' USING ERRCODE='55000'; END $$;
CREATE FUNCTION cop_safety_v2.append_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior bigint; head text; cfg cop_safety_v2.configuration%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(1932540802, 2);
  SELECT * INTO STRICT cfg FROM cop_safety_v2.configuration WHERE singleton;
  SELECT sequence,digest INTO prior,head FROM cop_safety_v2.fences ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence <> coalesce(prior,0)+1 OR NEW.previous_digest <> coalesce(head,cfg.initial_digest)
    OR NEW.entry->>'accountKey' IS DISTINCT FROM NEW.account_key
    OR NEW.entry->>'applicationStoreId' IS DISTINCT FROM cfg.application_store_id::text
    OR NEW.entry->>'configurationFingerprint' IS DISTINCT FROM cfg.configuration_fingerprint
    OR NEW.entry->'job'->>'operationId' IS DISTINCT FROM NEW.operation_id::text
    OR (NEW.entry->'job'->>'requestedAt')::timestamptz IS DISTINCT FROM NEW.requested_at THEN
    RAISE EXCEPTION 'fence_binding_or_chain_conflict';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER append_fence BEFORE INSERT ON cop_safety_v2.fences FOR EACH ROW EXECUTE FUNCTION cop_safety_v2.append_fence();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['configuration','fences'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON cop_safety_v2.%I FOR EACH ROW EXECUTE FUNCTION cop_safety_v2.immutable()',name);
    EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON cop_safety_v2.%I FOR EACH STATEMENT EXECUTE FUNCTION cop_safety_v2.immutable()',name);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA cop_safety_v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cop_safety_v2 FROM PUBLIC;
-- Deployment grants narrow LOGIN roles separately after review. COP: SELECT
-- configuration/fences/dataset_replays, INSERT fences, EXECUTE append_fence,
-- UPDATE(replay_sequence,replay_digest) only on dataset_replays. The application
-- advances this cursor only after actual local fence/config readback. Identity,
-- incarnation, generation and initial enrollment stay administrator-only.
-- SIM owns its independent sim_erasure_guard_v2 schema and manifests. Runtime
-- cannot accept a COP deployment/restore replay.
COMMIT;
