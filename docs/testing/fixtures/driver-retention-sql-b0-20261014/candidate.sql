-- SOURCE CANDIDATE ONLY. Apply exclusively to the owned ephemeral fixture.
-- Not an accepted native authority, SDK, production migration or retention policy.
BEGIN;
CREATE ROLE cop_retention_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE cop_retention_control LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE cop_retention_exec LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE cop_retention_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Lets the NOLOGIN function owner inspect only the executor role's activity;
-- grants no runtime/control membership or cluster-wide pg_read_all_stats.
GRANT cop_retention_exec TO cop_retention_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA cop_retention_source AUTHORIZATION cop_retention_owner;

CREATE TABLE public.driver_measurement_receipts (
 owner text NOT NULL CHECK(owner='cop'),batch_id uuid NOT NULL,
 contributor_hash char(64) NOT NULL,expires_at timestamptz NOT NULL,
 receipt jsonb NOT NULL DEFAULT '{}',PRIMARY KEY(owner,batch_id)
);
CREATE TABLE public.driver_measurement_intervals (
 owner text NOT NULL,batch_id uuid NOT NULL,measurement_key char(64) NOT NULL,
 dataset text NOT NULL,PRIMARY KEY(owner,measurement_key),
 FOREIGN KEY(owner,batch_id) REFERENCES public.driver_measurement_receipts ON DELETE CASCADE
);
CREATE TABLE public.driver_measurement_eta (
 owner text NOT NULL,batch_id uuid NOT NULL,observation_id uuid NOT NULL,
 contributor_hash char(64) NOT NULL,dataset text NOT NULL,PRIMARY KEY(owner,batch_id),
 FOREIGN KEY(owner,batch_id) REFERENCES public.driver_measurement_receipts ON DELETE CASCADE
);
CREATE TABLE public.driver_measurement_revocations (
 owner text NOT NULL CHECK(owner='cop'),contributor_hash char(64) NOT NULL,
 expires_at timestamptz NOT NULL,PRIMARY KEY(owner,contributor_hash)
);
-- Permanent fence sentinel is outside the destructive plan.
CREATE TABLE public.driver_account_erasure_fences (fence_id uuid PRIMARY KEY);
ALTER TABLE public.driver_measurement_receipts OWNER TO cop_retention_owner;
ALTER TABLE public.driver_measurement_intervals OWNER TO cop_retention_owner;
ALTER TABLE public.driver_measurement_eta OWNER TO cop_retention_owner;
ALTER TABLE public.driver_measurement_revocations OWNER TO cop_retention_owner;

SET ROLE cop_retention_owner;
CREATE TABLE cop_retention_source.store_binding (
 singleton boolean PRIMARY KEY CHECK(singleton),incarnation uuid NOT NULL UNIQUE
);
INSERT INTO cop_retention_source.store_binding VALUES(true,'00000000-0000-4000-8000-000000000001');
CREATE TABLE cop_retention_source.origins (
 operation_id uuid PRIMARY KEY,store_incarnation uuid NOT NULL,
 operation_code text NOT NULL CHECK(operation_code IN ('whole-cop-expiry-v1','contributor-revocation-source-v1')),
 permit_id uuid NOT NULL,body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 schema_digest text NOT NULL CHECK(schema_digest ~ '^[0-9a-f]{64}$'),
 cutoff timestamptz,contributor_hash text,revocation_until timestamptz,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','claimed','committed','sealed_no_effect')),
 claim_id uuid,claimed_xid8 xid8,backend_pid integer,backend_start timestamptz,
 committed_marker boolean NOT NULL DEFAULT false,sealed_at timestamptz,
 CHECK((operation_code='whole-cop-expiry-v1' AND cutoff IS NOT NULL AND contributor_hash IS NULL AND revocation_until IS NULL)
   OR (operation_code='contributor-revocation-source-v1' AND cutoff IS NULL AND contributor_hash IS NOT NULL AND contributor_hash ~ '^[0-9a-f]{64}$' AND revocation_until IS NOT NULL)),
 CHECK(state NOT IN ('claimed','committed') OR (claim_id IS NOT NULL AND claimed_xid8 IS NOT NULL AND backend_pid IS NOT NULL AND backend_start IS NOT NULL)),
 CHECK(committed_marker=(state='committed'))
);

CREATE FUNCTION cop_retention_source.immutable_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'origin_delete_denied'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','claim_id','claimed_xid8','backend_pid','backend_start','committed_marker','sealed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','claim_id','claimed_xid8','backend_pid','backend_start','committed_marker','sealed_at'])
 THEN RAISE EXCEPTION 'origin_binding_immutable'; END IF;
 IF OLD.state IN ('committed','sealed_no_effect') THEN RAISE EXCEPTION 'origin_terminal_immutable'; END IF;
 IF NOT ((OLD.state='prepared' AND NEW.state='claimed') OR
         (OLD.state IN ('prepared','claimed') AND NEW.state='sealed_no_effect') OR
         (OLD.state='claimed' AND NEW.state='committed'))
 THEN RAISE EXCEPTION 'origin_transition_denied'; END IF;
 IF OLD.state='claimed' AND ROW(NEW.claim_id,NEW.claimed_xid8,NEW.backend_pid,NEW.backend_start)
   IS DISTINCT FROM ROW(OLD.claim_id,OLD.claimed_xid8,OLD.backend_pid,OLD.backend_start)
 THEN RAISE EXCEPTION 'origin_claim_immutable'; END IF;
 IF NEW.state='committed' AND (NEW.claimed_xid8<>pg_current_xact_id() OR NEW.backend_pid<>pg_backend_pid())
 THEN RAISE EXCEPTION 'origin_commit_transaction_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER origin_immutable BEFORE UPDATE OR DELETE ON cop_retention_source.origins
 FOR EACH ROW EXECUTE FUNCTION cop_retention_source.immutable_origin();

CREATE FUNCTION cop_retention_source.register_origin(
 p_operation uuid,p_store uuid,p_code text,p_permit uuid,p_body text,p_schema text,
 p_cutoff timestamptz,p_contributor text,p_revocation_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r cop_retention_source.origins%ROWTYPE;
BEGIN
 IF p_store IS DISTINCT FROM (SELECT incarnation FROM cop_retention_source.store_binding WHERE singleton)
 THEN RAISE EXCEPTION 'store_incarnation_mismatch'; END IF;
 INSERT INTO cop_retention_source.origins(operation_id,store_incarnation,operation_code,permit_id,body_digest,schema_digest,cutoff,contributor_hash,revocation_until)
 VALUES(p_operation,p_store,p_code,p_permit,p_body,p_schema,p_cutoff,p_contributor,p_revocation_until)
 ON CONFLICT(operation_id) DO NOTHING;
 SELECT * INTO r FROM cop_retention_source.origins WHERE operation_id=p_operation FOR UPDATE;
 IF ROW(r.store_incarnation,r.operation_code,r.permit_id,r.body_digest,r.schema_digest,r.cutoff,r.contributor_hash,r.revocation_until)
  IS DISTINCT FROM ROW(p_store,p_code,p_permit,p_body,p_schema,p_cutoff,p_contributor,p_revocation_until)
 THEN RAISE EXCEPTION 'origin_registration_conflict'; END IF;
 RETURN jsonb_build_object('operationId',r.operation_id,'state',r.state);
END $$;

CREATE FUNCTION cop_retention_source.claim_origin(
 p_operation uuid,p_store uuid,p_xid xid8,p_pid integer,p_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r cop_retention_source.origins%ROWTYPE;
BEGIN
 SELECT * INTO r FROM cop_retention_source.origins WHERE operation_id=p_operation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'origin_missing'; END IF;
 IF r.store_incarnation IS DISTINCT FROM p_store OR p_store IS DISTINCT FROM
  (SELECT incarnation FROM cop_retention_source.store_binding WHERE singleton)
 THEN RAISE EXCEPTION 'store_incarnation_mismatch'; END IF;
 IF r.state<>'prepared' THEN RAISE EXCEPTION 'origin_claim_already_issued_or_closed'; END IF;
 -- p_xid/pid/start are read directly by the ROOT-controlled origin connection,
 -- never supplied by the ordinary app. SQL additionally checks the live backend.
 IF NOT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.pid=p_pid
   AND a.backend_start=p_start AND a.datname=current_database()
   AND a.usename='cop_retention_exec' AND a.xact_start IS NOT NULL
   AND a.state IN ('active','idle in transaction') AND a.backend_xid IS NOT NULL
   AND a.backend_xid::text::numeric=mod(p_xid::text::numeric,4294967296))
 THEN RAISE EXCEPTION 'origin_backend_not_current'; END IF;
 UPDATE cop_retention_source.origins SET state='claimed',claim_id=gen_random_uuid(),
  claimed_xid8=p_xid,backend_pid=p_pid,backend_start=p_start WHERE operation_id=p_operation
 RETURNING * INTO r;
 RETURN jsonb_build_object('operationId',r.operation_id,'claimId',r.claim_id,'state',r.state);
END $$;

CREATE FUNCTION cop_retention_source.expire_origin(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r cop_retention_source.origins%ROWTYPE;
BEGIN
 SELECT * INTO r FROM cop_retention_source.origins WHERE operation_id=p_operation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'origin_missing'; END IF;
 IF r.state<>'claimed' OR r.operation_code<>'whole-cop-expiry-v1'
 THEN RAISE EXCEPTION 'origin_not_claimed_for_expiry'; END IF;
 IF r.store_incarnation IS DISTINCT FROM (SELECT incarnation FROM cop_retention_source.store_binding WHERE singleton)
  OR r.claimed_xid8<>pg_current_xact_id() OR r.backend_pid<>pg_backend_pid()
  OR r.backend_start IS DISTINCT FROM (SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 THEN RAISE EXCEPTION 'origin_transaction_mismatch'; END IF;
 DELETE FROM public.driver_measurement_receipts WHERE owner='cop' AND expires_at<=r.cutoff;
 DELETE FROM public.driver_measurement_revocations WHERE owner='cop' AND expires_at<=r.cutoff;
 UPDATE cop_retention_source.origins SET state='committed',committed_marker=true WHERE operation_id=p_operation;
 RETURN jsonb_build_object('operationId',r.operation_id,'observed','effects_and_marker_in_origin_transaction');
END $$;

-- Narrow SOURCE seam, not accepted COP identity/consent/erasure authority.
-- Future Root composition must bind the contributor and revocation-until policy;
-- the ordinary app cannot choose them or invoke this executor channel.
CREATE FUNCTION cop_retention_source.revoke_contributor_origin(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r cop_retention_source.origins%ROWTYPE;
BEGIN
 SELECT * INTO r FROM cop_retention_source.origins WHERE operation_id=p_operation FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'origin_missing'; END IF;
 IF r.state<>'claimed' OR r.operation_code<>'contributor-revocation-source-v1'
 THEN RAISE EXCEPTION 'origin_not_claimed_for_revocation'; END IF;
 IF r.store_incarnation IS DISTINCT FROM (SELECT incarnation FROM cop_retention_source.store_binding WHERE singleton)
  OR r.claimed_xid8<>pg_current_xact_id() OR r.backend_pid<>pg_backend_pid()
  OR r.backend_start IS DISTINCT FROM (SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid())
 THEN RAISE EXCEPTION 'origin_transaction_mismatch'; END IF;
 INSERT INTO public.driver_measurement_revocations(owner,contributor_hash,expires_at)
 VALUES('cop',r.contributor_hash,r.revocation_until)
 ON CONFLICT(owner,contributor_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at;
 DELETE FROM public.driver_measurement_receipts WHERE owner='cop' AND contributor_hash=r.contributor_hash;
 UPDATE cop_retention_source.origins SET state='committed',committed_marker=true WHERE operation_id=p_operation;
 RETURN jsonb_build_object('operationId',r.operation_id,'observed','revocation_and_marker_in_origin_transaction');
END $$;

CREATE FUNCTION cop_retention_source.resolve_or_seal(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r cop_retention_source.origins%ROWTYPE;
BEGIN
 PERFORM set_config('lock_timeout','200ms',true);
 BEGIN
  SELECT * INTO r FROM cop_retention_source.origins WHERE operation_id=p_operation FOR UPDATE;
 EXCEPTION WHEN lock_not_available THEN
  RETURN jsonb_build_object('operationId',p_operation,'state','pending','reason','origin_busy');
 END;
 IF NOT FOUND THEN RETURN jsonb_build_object('operationId',p_operation,'state','pending','reason','origin_missing'); END IF;
 IF r.store_incarnation IS DISTINCT FROM (SELECT incarnation FROM cop_retention_source.store_binding WHERE singleton)
 THEN RETURN jsonb_build_object('operationId',p_operation,'state','pending','reason','store_incarnation_mismatch'); END IF;
 IF r.state='committed' THEN
  RETURN jsonb_build_object('operationId',p_operation,'state','origin_commit_known','quiescence','exact_origin_effect_closure');
 END IF;
 IF r.state='sealed_no_effect' THEN
  RETURN jsonb_build_object('operationId',p_operation,'state','origin_no_effect_closed','quiescence','exact_origin_effect_closure');
 END IF;
 UPDATE cop_retention_source.origins SET state='sealed_no_effect',sealed_at=clock_timestamp() WHERE operation_id=p_operation;
 RETURN jsonb_build_object('operationId',p_operation,'state','origin_no_effect_closed','quiescence','exact_origin_effect_closure');
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA cop_retention_source FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cop_retention_source FROM PUBLIC;
RESET ROLE;
GRANT USAGE ON SCHEMA cop_retention_source TO cop_retention_control,cop_retention_exec;
GRANT EXECUTE ON FUNCTION cop_retention_source.register_origin(uuid,uuid,text,uuid,text,text,timestamptz,text,timestamptz) TO cop_retention_control;
GRANT EXECUTE ON FUNCTION cop_retention_source.claim_origin(uuid,uuid,xid8,integer,timestamptz) TO cop_retention_control;
GRANT EXECUTE ON FUNCTION cop_retention_source.resolve_or_seal(uuid) TO cop_retention_control;
GRANT EXECUTE ON FUNCTION cop_retention_source.expire_origin(uuid) TO cop_retention_exec;
GRANT EXECUTE ON FUNCTION cop_retention_source.revoke_contributor_origin(uuid) TO cop_retention_exec;
GRANT SELECT ON public.driver_measurement_receipts,public.driver_measurement_intervals,public.driver_measurement_eta,public.driver_measurement_revocations TO cop_retention_runtime;
GRANT INSERT ON public.driver_measurement_receipts,public.driver_measurement_intervals,public.driver_measurement_eta TO cop_retention_runtime;
GRANT UPDATE(receipt) ON public.driver_measurement_receipts TO cop_retention_runtime;
COMMIT;
