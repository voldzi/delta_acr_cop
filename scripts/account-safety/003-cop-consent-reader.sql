-- Supplementary SOURCE candidate; no production application is implied.
-- Apply only after the reviewed COP consent schema migration, as DBA in 'cop'.
-- No password or LOGIN activation; credentials stay in protected host files.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='1s';
DO $preconditions$
BEGIN
  IF current_database()<>'cop' THEN RAISE EXCEPTION 'wrong_cop_database'; END IF;
  IF to_regrole('cop_guard_consent_reader') IS NOT NULL THEN RAISE EXCEPTION 'consent_reader_exists_review_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=to_regclass('public.cop_driver_measurement_config') AND relkind='r') OR
     NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=to_regclass('public.cop_driver_measurement_consents') AND relkind='r') OR
     NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=to_regclass('public.cop_driver_consent_erasure_fences') AND relkind='r')
    THEN RAISE EXCEPTION 'reviewed_cop_consent_schema_required'; END IF;
  IF (SELECT count(*) FROM (VALUES
      ('cop_driver_measurement_config','id'),('cop_driver_measurement_config','secret_fingerprint'),
      ('cop_driver_measurement_consents','subject_id'),('cop_driver_measurement_consents','owner_issuer'),
      ('cop_driver_measurement_consents','revoked_at'),('cop_driver_measurement_consents','pending_days'),
      ('cop_driver_consent_erasure_fences','subject_hash'),('cop_driver_consent_erasure_fences','owner_issuer'),
      ('cop_driver_consent_erasure_fences','operation_id'),('cop_driver_consent_erasure_fences','pending_days')) v(table_name,column_name)
      JOIN pg_catalog.pg_class c ON c.oid=to_regclass('public.'||v.table_name)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=v.column_name AND a.attnum>0 AND NOT a.attisdropped)<>10
    THEN RAISE EXCEPTION 'reviewed_cop_consent_columns_required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
    ('public.cop_driver_measurement_config'::regclass,'public.cop_driver_measurement_consents'::regclass,'public.cop_driver_consent_erasure_fences'::regclass)
    AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'cop_consent_rls_inventory_review_required'; END IF;
END
$preconditions$;
CREATE ROLE cop_guard_consent_reader NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0;
ALTER ROLE cop_guard_consent_reader SET default_transaction_read_only=on;
ALTER ROLE cop_guard_consent_reader SET statement_timeout='5s';
ALTER ROLE cop_guard_consent_reader SET lock_timeout='1s';
ALTER ROLE cop_guard_consent_reader SET search_path=pg_catalog;
GRANT CONNECT ON DATABASE cop TO cop_guard_consent_reader;
GRANT USAGE ON SCHEMA public TO cop_guard_consent_reader;
GRANT SELECT(id,secret_fingerprint) ON public.cop_driver_measurement_config TO cop_guard_consent_reader;
GRANT SELECT(subject_id,owner_issuer,revoked_at,pending_days) ON public.cop_driver_measurement_consents TO cop_guard_consent_reader;
GRANT SELECT(subject_hash,owner_issuer,operation_id,pending_days) ON public.cop_driver_consent_erasure_fences TO cop_guard_consent_reader;
DO $postconditions$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member='cop_guard_consent_reader'::regrole OR roleid='cop_guard_consent_reader'::regrole)
    THEN RAISE EXCEPTION 'consent_reader_membership_forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p') AND
      (has_table_privilege('cop_guard_consent_reader',c.oid,'INSERT') OR has_table_privilege('cop_guard_consent_reader',c.oid,'UPDATE') OR
       has_table_privilege('cop_guard_consent_reader',c.oid,'DELETE') OR has_table_privilege('cop_guard_consent_reader',c.oid,'TRUNCATE') OR
       has_table_privilege('cop_guard_consent_reader',c.oid,'TRIGGER') OR has_table_privilege('cop_guard_consent_reader',c.oid,'REFERENCES') OR
       has_any_column_privilege('cop_guard_consent_reader',c.oid,'INSERT') OR has_any_column_privilege('cop_guard_consent_reader',c.oid,'UPDATE') OR
       has_any_column_privilege('cop_guard_consent_reader',c.oid,'REFERENCES')))
    THEN RAISE EXCEPTION 'consent_reader_effective_write_forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef AND
      has_function_privilege('cop_guard_consent_reader',p.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'consent_reader_definer_function_review_required'; END IF;
  IF has_schema_privilege('cop_guard_consent_reader','public','CREATE') OR has_database_privilege('cop_guard_consent_reader',current_database(),'CREATE')
    THEN RAISE EXCEPTION 'consent_reader_create_forbidden'; END IF;
END
$postconditions$;
COMMIT;
