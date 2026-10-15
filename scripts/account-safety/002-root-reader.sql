-- Candidate supplementary migration; NOT applied to production by this file.
-- DBA runs only on the existing closed account-safety metadata database.
-- Role starts NOLOGIN and has no password/member roles. Separate protected
-- credential provisioning/LOGIN activation is required after acceptance.
BEGIN;
DO $preconditions$
DECLARE names text[]; role_name text;
BEGIN
  IF current_database() <> 'cop_account_safety_guard' THEN RAISE EXCEPTION 'wrong_guard_database'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(current_database()),904214);
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_database d,
    LATERAL pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
    WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type IN ('CREATE','CONNECT','TEMPORARY'))
    THEN RAISE EXCEPTION 'guard_database_public_access_requires_separate_review'; END IF;
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO names
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cop_guard' AND c.relkind IN ('r','p');
  IF names IS DISTINCT FROM ARRAY['accepted_runtime_proofs','checkpoint_acceptances','dataset_bindings','fence_journal',
    'guard_identity','owner_receipts','policies','replay_operations','runtime_bindings'] THEN RAISE EXCEPTION 'unexpected_guard_schema'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cop_guard' AND c.relkind IN ('r','p') AND c.relowner <> 'cop_guard_owner'::regrole) THEN
    RAISE EXCEPTION 'unexpected_guard_owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='cop_guard.owner_receipts'::regclass AND c.relrowsecurity)
    THEN RAISE EXCEPTION 'receipt_rls_required'; END IF;
  IF to_regrole('cop_guard_root_reader') IS NOT NULL THEN RAISE EXCEPTION 'reader_role_already_exists_review_required'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
    ('cop_guard_owner','cop_guard_probe','cop_guard_journal_writer','cop_guard_root_enroller',
     'cop_guard_root_checkpoint_acceptor','cop_guard_sim_driver_receipt_writer','cop_guard_sim_ai_receipt_writer')) <> 7
    THEN RAISE EXCEPTION 'foundation_role_missing'; END IF;
  FOR role_name IN SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.rolname IN
    ('cop_guard_owner','cop_guard_probe','cop_guard_journal_writer','cop_guard_root_enroller',
     'cop_guard_root_checkpoint_acceptor','cop_guard_sim_driver_receipt_writer','cop_guard_sim_ai_receipt_writer') LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=role_name AND
      (r.rolcanlogin OR r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
      THEN RAISE EXCEPTION 'existing_guard_role_changed'; END IF;
  END LOOP;
END
$preconditions$;
CREATE ROLE cop_guard_root_reader NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0;
ALTER ROLE cop_guard_root_reader SET default_transaction_read_only=on;
ALTER ROLE cop_guard_root_reader SET statement_timeout='5s';
ALTER ROLE cop_guard_root_reader SET lock_timeout='1s';
GRANT CONNECT ON DATABASE cop_account_safety_guard TO cop_guard_root_reader;
GRANT USAGE ON SCHEMA cop_guard TO cop_guard_root_reader;
GRANT SELECT ON cop_guard.guard_identity,cop_guard.policies,cop_guard.fence_journal,
  cop_guard.dataset_bindings,cop_guard.runtime_bindings,cop_guard.accepted_runtime_proofs,
  cop_guard.replay_operations,cop_guard.owner_receipts,cop_guard.checkpoint_acceptances TO cop_guard_root_reader;
CREATE POLICY root_readonly_receipt_read ON cop_guard.owner_receipts FOR SELECT TO cop_guard_root_reader USING (true);
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system(),pg_catalog.pg_control_checkpoint() TO cop_guard_root_reader;
DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member='cop_guard_root_reader'::regrole OR roleid='cop_guard_root_reader'::regrole)
    THEN RAISE EXCEPTION 'reader_membership_forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cop_guard' AND c.relkind IN ('r','p') AND
      (has_table_privilege('cop_guard_root_reader',c.oid,'INSERT') OR has_table_privilege('cop_guard_root_reader',c.oid,'UPDATE') OR
       has_table_privilege('cop_guard_root_reader',c.oid,'DELETE') OR has_table_privilege('cop_guard_root_reader',c.oid,'TRUNCATE') OR
       has_table_privilege('cop_guard_root_reader',c.oid,'TRIGGER') OR has_table_privilege('cop_guard_root_reader',c.oid,'REFERENCES') OR
       has_any_column_privilege('cop_guard_root_reader',c.oid,'INSERT') OR has_any_column_privilege('cop_guard_root_reader',c.oid,'UPDATE') OR
       has_any_column_privilege('cop_guard_root_reader',c.oid,'REFERENCES')))
    THEN RAISE EXCEPTION 'reader_write_privilege_forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='cop_guard' AND has_function_privilege('cop_guard_root_reader',p.oid,'EXECUTE')) OR
     has_schema_privilege('cop_guard_root_reader','cop_guard','CREATE') OR has_schema_privilege('cop_guard_root_reader','public','CREATE') OR
     has_database_privilege('cop_guard_root_reader',current_database(),'CREATE') OR has_database_privilege('cop_guard_root_reader',current_database(),'TEMPORARY')
    THEN RAISE EXCEPTION 'reader_authority_escalation_forbidden'; END IF;
END
$postconditions$;
COMMIT;
