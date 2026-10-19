-- COP account deletion: online projection-lookup indexes.
-- Run deliberately, ONE statement/stage at a time, on the current primary/cop.
-- Not an API startup migration; never run CREATE INDEX CONCURRENTLY inside BEGIN.
-- Preserve all data, existing owner index, and the application five-second guard.
-- Require fresh disk/WAL/replication checks and a server-side owned-backend watchdog.
-- Existing names must be checked against table, definition, valid/ready and provenance.
-- No blind IF NOT EXISTS, DROP or automatic cleanup of another operation's index.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
-- Verify actual extension schema/version and public.gin_trgm_ops before continuing.

CREATE INDEX CONCURRENTLY cop_th_object_lower_trgm_20261019_idx
  ON public.cop_track_history USING gin (lower(object_id) public.gin_trgm_ops);

-- Separate checkpoint: valid+ready, app health, free space, WAL and replication.
CREATE INDEX CONCURRENTLY cop_th_source_lower_trgm_20261019_idx
  ON public.cop_track_history USING gin (lower(source_system_id) public.gin_trgm_ops);

-- Acceptance: the complete three-OR preflight must avoid a full history scan.
-- The existing cop_track_history_owner_idx remains required for the owner branch.
-- Invalid index cleanup is a separate exact-OID/provenance operation, never blanket.

-- Deliberate statistics refresh after both valid/ready index checkpoints.
-- Required for the complete owner/object/source OR plan; no global ANALYZE.
ANALYZE public.cop_track_history(owner_subject_hash, object_id, source_system_id);
