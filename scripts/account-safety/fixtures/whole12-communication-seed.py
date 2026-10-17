"""Fresh whole12 projection of the reviewed two-owner native seed.
Only fixture issuer/owner constants differ; production provider modules unchanged.
This does not claim actual production Root admission or completed deletion.
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import quote

import psycopg2
from psycopg2.extras import Json
import yaml

SOURCE = Path("/data/source")
PRIVATE = Path("/data/joint-private.json")
SERVER = "cop-erasure.invalid"
ISSUER = "https://cop-erasure-keycloak.invalid/realms/cop"
POLICY = "0a6fc9bdcbbff0c5f31f46326974cf92f2ba7558ac72067f2f1af86d3675149d"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
IDS = {"guard": "10000000-0000-4000-8000-000000000001",
       "metadata": "20000000-0000-4000-8000-000000000001",
       "metadataIncarnation": "21000000-0000-4000-8000-000000000001",
       "provider": "50000000-0000-4000-8000-000000000001",
       "providerIncarnation": "51000000-0000-4000-8000-000000000001"}
BOOTSTRAP_STAGE = "initial"
PROFILE = "full-v2-credential-first-creation-v1"
FIXTURE_OWNER = "cop-clean-whole12-9aff26e65b74"


def principal(owner):
    if not UUID.fullmatch(owner):
        raise ValueError("JOINT_EXACT_KC_SUBJECT_REQUIRED")
    return "@cop_" + owner + "_" + hashlib.sha256(owner.encode()).hexdigest()[:12] + ":" + SERVER


def actor_scope(cfg):
    # Shape and exact namespace only. Real Keycloak issuer/signature/userinfo
    # verification is performed by the server-local COP bootstrap producer;
    # this parser never treats UUID syntax as proof of a real login.
    subjects = cfg.get("subjects")
    if not isinstance(subjects, dict) or set(subjects) != {"a", "b"}:
        raise ValueError("JOINT_PRIMARY_SUBJECTS_INVALID")
    values = dict(subjects)
    if "additionalActors" in cfg:
        extra = cfg["additionalActors"]
        if not isinstance(extra, dict) or set(extra) != {"c", "d"}:
            raise ValueError("JOINT_ADDITIONAL_ACTORS_INVALID")
        for label, role in (("c", "novice"), ("d", "peer")):
            value = extra[label]
            if not isinstance(value, dict) or set(value) != {"subjectId", "role"} or value["role"] != role:
                raise ValueError("JOINT_ADDITIONAL_ACTOR_ROLE_INVALID")
            values[label] = value["subjectId"]
    if any(not isinstance(v, str) or not UUID.fullmatch(v) for v in values.values()) or len(set(values.values())) != len(values):
        raise ValueError("JOINT_CANONICAL_DISTINCT_ACTORS_REQUIRED")
    return values


def private_write(path, value):
    encoded = json.dumps(value, default=str).encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(encoded)


def connect(database="postgres", role="owned_fixture_admin"):
    connection = psycopg2.connect(host="127.0.0.1", port=5432, database=database,
                                  user=role, connect_timeout=5)
    connection.autocommit = True
    return connection


def sql(connection, statement, values=None):
    with connection.cursor() as cursor:
        cursor.execute(statement, values)
        return cursor.fetchall() if cursor.description else []


def request(method, path, body=None, token=None):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    call = Request("http://127.0.0.1:8008" + path, method=method, headers=headers,
                   data=None if body is None else json.dumps(body).encode())
    try:
        response = urlopen(call, timeout=20)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("JOINT_REPLY_TOO_LARGE")
        return response.code, json.loads(raw) if raw else {}


def qualify_stats_driver(source, users):
    # The reused fixture driver imports exactly two reviewed classifier/module
    # definitions. A changed legacy driver must be reviewed, never partly mixed.
    old_import = "from cop_account_erasure import "
    user_guard = 'not x.startswith("@cop_synthetic_")'
    count_guard = 'len(config["users"])!=2'
    if not isinstance(users, tuple) or len(users) not in (2,4) or len(set(users)) != len(users):
        raise ValueError("JOINT_STATS_EXACT_ACTORS_REQUIRED")
    for user in users:
        match = re.fullmatch(r"@cop_([0-9a-f-]{36})_[0-9a-f]{12}:cop-erasure\.invalid", user) if isinstance(user,str) else None
        if not match or principal(match[1]) != user:
            raise ValueError("JOINT_STATS_EXACT_ACTORS_REQUIRED")
    if source.count(old_import) != 2 or source.count(user_guard) != 1 or source.count(count_guard) != 1:
        raise ValueError("JOINT_LEGACY_HELPER_SOURCE_CHANGED")
    strict = '(not isinstance(config["users"],list) or tuple(config["users"])!='+repr(users)+')'
    return source.replace(old_import, "from cop_account_erasure_full_v2_credential_candidate import ").replace(user_guard, "x not in " + repr(users)).replace(count_guard,strict)


def validate_pristine_resume(admin):
    # New profile never adopts a prior case, failed bootstrap or old operation.
    if Path("/data/joint-pristine-resume.json").exists():
        raise ValueError("JOINT_NEW_CASE_CANNOT_RESUME_OLD_BOOTSTRAP")
    return False


def validate_bootstrap(cfg):
    if not isinstance(cfg, dict) or set(cfg) not in ({"contractVersion", "issuer", "subjects", "clientIds", "serviceToken", "root"},
       {"contractVersion", "issuer", "subjects", "clientIds", "serviceToken", "root", "additionalActors"}) or \
       cfg.get("contractVersion") != "cop-messaging-joint-bootstrap-v1" or cfg.get("issuer") != ISSUER or \
       not isinstance(cfg.get("subjects"), dict) or set(cfg["subjects"]) != {"a", "b"} or \
       cfg["subjects"]["a"] == cfg["subjects"]["b"] or not isinstance(cfg.get("clientIds"), list) or \
       not isinstance(cfg.get("serviceToken"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", cfg["serviceToken"]) or \
       not isinstance(cfg.get("root"), str):
        raise ValueError("JOINT_KC_BOOTSTRAP_INVALID")
    all_actors = actor_scope(cfg)
    if any(not isinstance(x,str) for x in cfg["clientIds"]):
        raise ValueError("JOINT_KC_CLIENTS_INVALID")
    clients = sorted(cfg["clientIds"])
    if not 1 <= len(clients) <= 8 or len(set(clients)) != len(clients) or \
       any(not isinstance(x, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", x) for x in clients):
        raise ValueError("JOINT_KC_CLIENTS_INVALID")
    try:
        if len(base64.b64decode(cfg["root"],validate=True))!=32:
            raise ValueError()
    except Exception:
        raise ValueError("JOINT_SYNTHETIC_ROOT_INVALID") from None
    return all_actors,clients


def bootstrap(clean=False):
    global BOOTSTRAP_STAGE
    if Path.cwd() != Path("/data") or PRIVATE.exists() or Path("homeserver.yaml").exists():
        raise ValueError("JOINT_FRESH_OWNED_DATA_REQUIRED")
    cfg = json.loads(Path("/data/joint-bootstrap.json").read_text())
    all_actors,clients = validate_bootstrap(cfg)
    owners = tuple(cfg["subjects"][key] for key in ("a", "b"))
    users = tuple(principal(owner) for owner in owners)
    stats_users = tuple(principal(all_actors[label]) for label in ("a", "b", "c", "d") if label in all_actors)
    admin = connect()
    BOOTSTRAP_STAGE = "isolated_databases"
    try:
        if sql(admin, "SELECT current_setting('cluster_name')")[0][0] != "messaging_approved_joint_fixture":
            raise ValueError("JOINT_CLUSTER_IDENTITY_MISMATCH")
        if not validate_pristine_resume(admin):
            sql(admin, "CREATE ROLE csm_synapse LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
            sql(admin, "CREATE ROLE messaging_joint_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
            sql(admin, "CREATE ROLE messaging_joint_guard LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
            sql(admin, "CREATE DATABASE csm_synapse OWNER csm_synapse TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'")
            sql(admin, "CREATE DATABASE csm_messaging")
        if not sql(admin, "SELECT 1 FROM pg_database WHERE datname='cop_account_safety_guard'"):
            sql(admin, "CREATE DATABASE cop_account_safety_guard")
    finally:
        admin.close()
    legacy_path = SOURCE / "test/provider/synapse_account_state_v2_probe.py"
    spec = importlib.util.spec_from_file_location("joint_source_seed_helpers", legacy_path)
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    # Reuse real upstream cache/key producers, not a fake provider. The only
    # fixture guard adaptation replaces a prefix with the TWO exact KC users.
    legacy.STATS_DRIVER = qualify_stats_driver(legacy.STATS_DRIVER, stats_users)

    class JointFixture(legacy.Fixture):
        def request(self, method, path, body=None, token=None, expected=200,
                    content_type="application/json", extra_headers=None, json_response=True):
            headers = {"Content-Type": content_type, **(extra_headers or {})}
            if token:
                headers["Authorization"] = "Bearer " + token
            raw = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode()
            call = Request("http://127.0.0.1:8008" + path, data=raw, method=method, headers=headers)
            try:
                response = urlopen(call, timeout=25)
            except HTTPError as error:
                response = error
            with response:
                value = response.read(1_048_577)
                if response.code != expected or len(value) > 1_048_576:
                    raise ValueError("JOINT_NATIVE_REQUEST_FAILED")
                return (json.loads(value) if value else {}) if json_response else value

    BOOTSTRAP_STAGE = "upstream_fixture_creation"
    fixture = JointFixture()
    fixture.names = tuple(user.split(":", 1)[0][1:] for user in users)
    fixture.users = users
    fixture.config["listeners"][0]["port"] = 8008
    Path("homeserver.yaml").write_text(yaml.safe_dump(fixture.config))
    Path("homeserver.yaml").chmod(0o600)
    candidate_modules = [
        {"module": "cop_private_erasure.PrivateErasure", "config": {"contractVersion": "cop-synapse-private-metadata-v1"}},
        {"module": "cop_account_erasure_full_v2_credential_candidate.AccountErasure", "config": {
            "contractVersion": "cop-synapse-account-state-v2", "approvedRetentionPolicyDigest": POLICY, "approvedScopeVersion": "full-v2-credential-candidate-v1"}},
        {"module": "fixture_stats_driver.StatsFixtureDriver", "config": {"users": list(stats_users)}}]
    # Only A/B historical fixture accounts are seeded through native creation
    # before candidate admission is activated. C/D remain genuinely absent.
    Path("fixture-modules.yaml").write_text(yaml.safe_dump({"modules": [candidate_modules[0],candidate_modules[2]]}))
    BOOTSTRAP_STAGE = "actual_synapse_start"
    fixture.start()
    Path("/data/joint-provider.pid").write_text(str(fixture.process.pid))
    Path("/data/joint-provider.pid").chmod(0o600)
    BOOTSTRAP_STAGE = "restricted_prerequisite_migrations"
    fixture.install()
    for name in ("003_approved_provider_binding.sql", "004_approved_owner_payload_fences.sql",
                 "005_reviewed_owner_stream_cleanup.sql", "006_credential_stream_origin_witness.sql",
                 "007_credential_stream_restore_lineage.sql", "008_native_first_creation.sql"):
        BOOTSTRAP_STAGE = "root_migration_" + name[:3]
        # This SQL contains PL/pgSQL %ROWTYPE / format('%I',...). Passing
        # legacy args=() would let psycopg2 parse those as bind placeholders.
        sql(fixture.admin, Path(name).read_text())
    BOOTSTRAP_STAGE = "initial_provider_binding"
    scope = hashlib.sha256(Path("approved-account-scope-full-v2-credential-candidate.json").read_bytes()).hexdigest()
    fixture.sql("INSERT INTO cop_account_erasure_binding.dataset_binding VALUES(%s,%s,1,%s,%s,%s,'1.156.0')",
                (IDS["provider"], IDS["providerIncarnation"], POLICY, scope, SERVER))
    BOOTSTRAP_STAGE = "actual_synthetic_registration"
    control = fixture.register("joint-synthetic-control", True)["access_token"]
    # The clean-release case must exercise actual first-use admission. Its
    # metadata/usage baseline therefore contains no managed identity, and no
    # managed native user or token is created through the legacy admin seed.
    actors = [] if clean else [fixture.register(name) for name in fixture.names]
    for index, actor in enumerate(actors):
        BOOTSTRAP_STAGE = "actual_personal_seed_" + str(index)
        fixture.seed_personal_state(actor, index, control)
    BOOTSTRAP_STAGE = "actual_shared_room"
    room = None if clean else fixture.seed_shared_room(*actors)
    BOOTSTRAP_STAGE = "activate_candidate_after_primary_seed"
    # This is the child process created above in the NEW owned case, never an
    # old case or production service. Preserve seed logs and the same DB/data.
    fixture.process.terminate()
    fixture.process.wait(timeout=30)
    fixture.log.close()
    if Path("/data/provider-fixture-seed.log").exists():
        raise ValueError("JOINT_CANDIDATE_SEED_LOG_ALREADY_EXISTS")
    os.rename("/data/provider-fixture.log","/data/provider-fixture-seed.log")
    Path("fixture-modules.yaml").write_text(yaml.safe_dump({"modules":candidate_modules}))
    fixture.start()
    Path("/data/joint-provider.pid").write_text(str(fixture.process.pid))
    Path("/data/joint-provider.pid").chmod(0o600)
    root = cfg["root"]
    if len(base64.b64decode(root, validate=True)) != 32:
        raise ValueError("JOINT_SYNTHETIC_ROOT_INVALID")
    key = hmac.new(base64.b64decode(root), b"messaging-erasure-owner-mac-key-v1\0", hashlib.sha256).digest()
    fingerprint = hashlib.sha256(b"messaging-erasure-owner-key-fingerprint-v1\0" + key).hexdigest()
    common = {"contractVersion": "messaging-approved-joint-private-v1", "issuer": ISSUER,
        "subjects": cfg["subjects"], "clientIds": clients, "root": root,
        "serviceToken": cfg["serviceToken"],
        "matrixAdminToken": control, "metadataDatabase": "csm_messaging",
        "guardDatabase": "cop_account_safety_guard", "ids": IDS,
        "ownerKeyFingerprint": fingerprint, "providerScopeDigest": scope, "fixtureScopeProfile": "full-v2-credential-first-creation-v1",
        "fixtureOwner": "cop-clean-whole12-9aff26e65b74"}
    if "additionalActors" in cfg:
        common["additionalActors"] = cfg["additionalActors"]
    BOOTSTRAP_STAGE = "messaging_metadata_and_guard"
    seed_metadata(common, actors)
    private_write(Path("/data/component-private.json"), {**common,
        "messagingBaseUrl": "http://127.0.0.1:4000",
        "synapseBaseUrl": "http://127.0.0.1:8008"})
    private_write(PRIVATE, {**common, "actors": actors, "sharedRoom": room,
                            "cleanFirstUse": clean,
                            "otherOwnerSnapshot": None if clean else fixture.owner_snapshot(actors[1])})
    # The running provider process and all data live only in this owned tmpfs.
    print(json.dumps({"status": "bootstrapped", "actualProvider": True,
                      "targets": len(actors), "cleanFirstUse": clean,
                      "privatePath": str(PRIVATE)}))


def seed_admitted_native():
    """Real HTTP first use only, after all actual guards are ready.

    The private result is written only after both admitted users and their rich
    native state exist. A failed/partial case cannot be silently retried.
    """
    cfg = json.loads(PRIVATE.read_text())
    marker = Path('/data/admitted-native-seed-started.json')
    if cfg.get('cleanFirstUse') is not True or cfg['actors'] or marker.exists():
        raise ValueError('JOINT_FRESH_ADMITTED_NATIVE_REQUIRED')
    private_write(marker, {'started': True})
    actors = []
    for label in ('a', 'b'):
        result = messaging_request(cfg, cfg['subjects'][label], 'POST', '/api/v1/matrix/token',
            {'deviceId': 'COPIOS.WHOLE.'+label})
        if result.get('userId') != principal(cfg['subjects'][label]) or not result.get('accessToken'):
            raise ValueError('JOINT_REAL_NATIVE_ADMISSION_FAILED')
        actors.append({'user_id': result['userId'], 'device_id': result['deviceId'],
                       'access_token': result['accessToken']})
    spec = importlib.util.spec_from_file_location('admitted_native_seed_helpers',
        SOURCE/'test/provider/synapse_account_state_v2_probe.py')
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    # Attach the seed producer to the already running real native server. Do
    # not call Fixture.__init__/start/register, replace a store, or mint proof.
    fixture = object.__new__(legacy.Fixture)
    fixture.admin = connect('csm_synapse')
    fixture.runtime = connect('csm_synapse', 'csm_synapse')
    fixture.config = yaml.safe_load(Path('/data/homeserver.yaml').read_text())
    fixture.users = tuple(a['user_id'] for a in actors)
    fixture.connections = []
    fixture.request = lambda method, path, body=None, token=None, expected=200, content_type='application/json', extra_headers=None, json_response=True: _admitted_native_request(method,path,body,token,expected,content_type,extra_headers,json_response)
    try:
        for index, actor in enumerate(actors):
            fixture.seed_personal_state(actor,index,cfg['matrixAdminToken'])
        room = fixture.seed_shared_room(*actors)
        after = {**cfg, 'actors':actors, 'sharedRoom':room,
                 'otherOwnerSnapshot':fixture.owner_snapshot(actors[1])}
        encoded = json.dumps(after,default=str).encode()
        fd = os.open(PRIVATE,os.O_WRONLY|os.O_TRUNC|os.O_NOFOLLOW)
        with os.fdopen(fd,'wb') as out: out.write(encoded)
    finally:
        fixture.admin.close();fixture.runtime.close()
    print(json.dumps({'phase':'admitted_native_seed_complete','actualMessagingHttp':True,
        'actualNativeHttp':True,'managedAccounts':2,'legacyManagedRegistration':False,
        'productionTouched':False,'wholeAccountAccepted':False}))


def _admitted_native_request(method,path,body,token,expected,content_type,extra_headers,json_response):
    headers={'content-type':content_type,**(extra_headers or {})}
    if token: headers['authorization']='Bearer '+token
    raw=body if isinstance(body,bytes) else None if body is None else json.dumps(body).encode()
    try: response=urlopen(Request('http://127.0.0.1:8008'+path,data=raw,method=method,headers=headers),timeout=25)
    except HTTPError as error: response=error
    with response:
        raw=response.read(1048577)
        if response.code != expected or len(raw)>1048576:
            raise ValueError('JOINT_ADMITTED_NATIVE_SEED_REQUEST_FAILED')
        return (json.loads(raw) if raw else {}) if json_response else raw


def seed_metadata(cfg, actors):
    with connect("csm_messaging") as metadata:
        sql(metadata, "CREATE TABLE public.csm_messaging_stores(store_name text PRIMARY KEY,payload jsonb NOT NULL,inserted_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())")
        for name in ("001_metadata_writer_fences.sql", "003_metadata_dataset.sql",
                     "005_metadata_restore_transition.sql"):
            sql(metadata, (SOURCE / "deploy/account-safety" / name).read_text())
        identities = {}
        for owner, actor in zip((cfg["subjects"]["a"], cfg["subjects"]["b"]), actors):
            key = hashlib.sha256((SERVER + "\0" + owner).encode()).hexdigest()[:24]
            identities[key] = {"csmUserId": owner, "ownerIssuer": ISSUER,
                "ownerProvenanceVersion": 1, "serverName": SERVER, "matrixUserId": actor["user_id"],
                "localpart": actor["user_id"].split(":", 1)[0][1:],
                "password": actor["password"], "displayName": "Synthetic owned identity",
                "createdAt": "2026-10-16T00:00:00Z", "updatedAt": "2026-10-16T00:00:00Z"}
        stores = {"account_safety": {"version": 1, "fences": {}, "jizdaFences": {}, "bindings": {}},
            "mobility_effects_erasure": {"version": 1, "jobs": {}, "fences": {}},
            "account_erasure_jobs": {"version": 1, "jobs": {}},
            "matrix_identities": {"version": 1, "identities": identities},
            "notifications": {"version": 1, "notifications": {}, "idempotency": {}},
            "conversations": {"version": 2, "conversations": {}},
            "devices": {"version": 1, "devices": {}}}
        for name, value in stores.items():
            sql(metadata, "INSERT INTO csm_messaging_stores(store_name,payload) VALUES(%s,%s)", (name, Json(value)))
        identity_digest = hashlib.sha256(json.dumps([ISSUER, cfg["clientIds"]], separators=(",", ":")).encode()).hexdigest()
        sql(metadata, "INSERT INTO messaging_erasure_v2.dataset VALUES(true,'messaging-local-dataset-v2',%s,%s,%s,1,%s,%s,%s,%s,%s,%s,%s,%s)",
            (IDS["guard"], IDS["metadata"], IDS["metadataIncarnation"], IDS["provider"],
             "https://cop-erasure.invalid", SERVER, ISSUER, cfg["clientIds"], cfg["ownerKeyFingerprint"], identity_digest, POLICY))
        sql(metadata, "GRANT SELECT,INSERT,UPDATE ON public.csm_messaging_stores TO messaging_joint_runtime; GRANT USAGE ON SCHEMA messaging_erasure_v2 TO messaging_joint_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA messaging_erasure_v2 TO messaging_joint_runtime; GRANT INSERT ON messaging_erasure_v2.fences,messaging_erasure_v2.journal_mirror TO messaging_joint_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA messaging_erasure_v2 TO messaging_joint_runtime")
        sql(metadata, "REVOKE EXECUTE ON FUNCTION messaging_erasure_v2.dataset_root_transition() FROM messaging_joint_runtime")
    with connect("cop_account_safety_guard") as guard:
        sql(guard, (SOURCE / "deploy/account-safety/002_independent_guard.sql").read_text())
        sql(guard, (SOURCE / "deploy/account-safety/004_independent_restore_transition.credential-candidate.sql").read_text())
        sql(guard, (SOURCE / "deploy/account-safety/006_communication_usage.sql").read_text())
        sql(guard, "INSERT INTO messaging_safety_v2.configuration VALUES(true,'messaging-independent-guard-v1',%s,%s,%s,%s,%s,'cop_','messaging-erasure-owner-mac-v1',%s,%s,%s,%s,%s,%s)",
            (IDS["guard"], IDS["metadata"], IDS["provider"], "https://cop-erasure.invalid", SERVER,
             cfg["ownerKeyFingerprint"], ISSUER, cfg["clientIds"], identity_digest, POLICY, "0" * 64))
        for dataset, store, incarnation in (("messaging_metadata", IDS["metadata"], IDS["metadataIncarnation"]),
                                             ("synapse_provider", IDS["provider"], IDS["providerIncarnation"])):
            sql(guard, "INSERT INTO messaging_safety_v2.dataset_replays VALUES(%s,%s,%s,1,0,%s)", (dataset, store, incarnation, "0" * 64))
        sql(guard, "GRANT USAGE ON SCHEMA messaging_safety_v2 TO messaging_joint_guard; GRANT SELECT ON ALL TABLES IN SCHEMA messaging_safety_v2 TO messaging_joint_guard; GRANT INSERT ON messaging_safety_v2.journal TO messaging_joint_guard; GRANT UPDATE(replay_sequence,replay_digest) ON messaging_safety_v2.dataset_replays TO messaging_joint_guard; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA messaging_safety_v2 TO messaging_joint_guard")
        sql(guard, "REVOKE EXECUTE ON FUNCTION messaging_safety_v2.begin_dataset_restore(text,uuid,uuid,bigint,uuid,bigint) FROM messaging_joint_guard")
        sql(guard, "GRANT USAGE ON SCHEMA messaging_usage_v1 TO messaging_joint_guard; GRANT SELECT ON messaging_usage_v1.baselines,messaging_usage_v1.owners,messaging_usage_v1.admissions TO messaging_joint_guard; GRANT EXECUTE ON FUNCTION messaging_usage_v1.reserve(uuid,text,text,text,uuid,text,uuid) TO messaging_joint_guard")


def messaging_request(cfg, owner, method, path, body=None, expected=200, idempotency=None):
    headers = {"content-type": "application/json", "authorization": "Bearer " + cfg["serviceToken"],
               "x-csm-user-id": owner, "x-csm-oidc-issuer": cfg["issuer"]}
    if idempotency:
        headers["idempotency-key"] = idempotency
    call = Request("http://127.0.0.1:4000" + path, method=method, headers=headers,
                   data=None if body is None else json.dumps(body).encode())
    try:
        response = urlopen(call, timeout=20)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read(1_048_577)
        if response.code != expected or len(raw) > 1_048_576:
            raise ValueError("JOINT_REAL_MESSAGING_REQUEST_FAILED")
        return json.loads(raw) if raw else {}


def owned_metadata_snapshot(cfg, seed, label):
    owner = cfg["subjects"][label]
    key = hashlib.sha256((SERVER + "\0" + owner).encode()).hexdigest()[:24]
    reference = seed[label]
    connection = connect("csm_messaging")
    try:
        # Exact typed keys from successful real HTTP producers, not a dynamic
        # inventory or substring search through another account's payload.
        values = {}
        for store, collection, item in (
            ("matrix_identities", "identities", key),
            ("devices", "devices", reference["deviceId"]),
            ("conversations", "conversations", reference["conversationId"]),
            ("notifications", "notifications", reference["notificationId"])):
            rows = sql(connection, "SELECT payload->%s->%s FROM public.csm_messaging_stores WHERE store_name=%s",
                       (collection, item, store))
            if len(rows) != 1 or not isinstance(rows[0][0], dict):
                raise ValueError("JOINT_REAL_METADATA_SEED_MISSING")
            values[store] = rows[0][0]
        return values
    finally:
        connection.close()


def seed_messaging():
    if Path("/data/messaging-owned-seed.json").exists():
        raise ValueError("JOINT_MESSAGING_SEED_ALREADY_EXISTS")
    cfg = json.loads(PRIVATE.read_text())
    seed = {}
    for label in ("a", "b"):
        owner = cfg["subjects"][label]
        device = messaging_request(cfg, owner, "POST", "/api/v1/devices", {
            "platform": "ios", "apnsEnvironment": "sandbox",
            "deviceToken": "owned-joint-synthetic-push-" + label,
            "appBundleId": "cz.voldzi.copmobile", "locale": "cs-CZ",
            "timezone": "Europe/Prague", "preferences": {"categories": ["safety.alert"]}}, 201)["device"]
        conversation = messaging_request(cfg, owner, "POST", "/api/v1/conversations", {
            "type": "group", "title": "Synthetic private metadata " + label,
            "members": [], "metadata": {"source": "cop.joint-synthetic"}}, 201)["conversation"]
        notification = messaging_request(cfg, owner, "POST", "/api/v1/notifications", {
            "type": "safety.alert", "severity": "warning", "priority": "normal",
            "audience": {"userIds": [owner]}, "title": {"cs": "Syntetická kontrola"},
            "body": {"cs": "Výhradně izolované testovací údaje."},
            "source": {"providerId": "sim.safety-data", "layerId": "synthetic",
                       "featureId": "joint-fixture-" + label}}, 202, "joint-owned-notification-" + label)["notification"]
        if notification.get("deliverySummary", {}).get("dryRunCount") != 1:
            raise ValueError("JOINT_DRY_RUN_DELIVERY_REQUIRED")
        seed[label] = {"deviceId": device["deviceId"], "conversationId": conversation["conversationId"],
                       "notificationId": notification["notificationId"]}
    seed["otherOwnerMetadataSnapshot"] = owned_metadata_snapshot(cfg, seed, "b")
    # This file intentionally contains private fixture payload and encrypted
    # registration data. Only its tmpfs reference may leave the namespace.
    private_write(Path("/data/messaging-owned-seed.json"), seed)
    print(json.dumps({"status": "messaging_seeded", "actualHttpProducers": True,
                      "targets": 2, "pushDelivery": "dry_run", "productionChanged": False}))


def verify_preserved():
    cfg = json.loads(PRIVATE.read_text())
    seed = json.loads(Path("/data/messaging-owned-seed.json").read_text())
    if owned_metadata_snapshot(cfg, seed, "b") != seed["otherOwnerMetadataSnapshot"]:
        raise ValueError("JOINT_OTHER_OWNER_METADATA_CHANGED")
    spec = importlib.util.spec_from_file_location("joint_preservation_readback", SOURCE / "test/provider/synapse_account_state_v2_probe.py")
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    fixture = legacy.Fixture.__new__(legacy.Fixture)
    fixture.admin = connect("csm_synapse")
    try:
        actual = fixture.owner_snapshot(cfg["actors"][1])
        if json.loads(json.dumps(actual, default=str)) != cfg["otherOwnerSnapshot"]:
            raise ValueError("JOINT_OTHER_PROVIDER_OWNER_CHANGED")
    finally:
        fixture.admin.close()
    actor = cfg["actors"][1]
    status, event = request("GET", "/_matrix/client/v3/rooms/" + quote(cfg["sharedRoom"], safe="")
                            + "/event/" + quote(actor["eventId"], safe=""), token=actor["access_token"])
    if status != 200 or event.get("sender") != actor["user_id"] or \
       event.get("content", {}).get("body") != "Synthetic non-production message 1":
        raise ValueError("JOINT_OTHER_OWNER_LIVE_EVENT_UNAVAILABLE")
    print(json.dumps({"status": "preserved", "providerOwnerBExact": True,
                      "messagingOwnerBExact": True, "actualOtherOwnerHttpRead": True,
                      "productionChanged": False, "wholeCopAccepted": False}))


def enrollment_status():
    state = json.loads(Path("/data/joint-enrollment-hold.json").read_text())
    if set(state) != {"backendPid"} or not isinstance(state["backendPid"], int) or state["backendPid"] <= 1:
        raise ValueError("JOINT_ENROLLMENT_HOLDER_INVALID")
    connection = connect("csm_synapse")
    try:
        if sql(connection, "SELECT EXISTS(SELECT FROM pg_locks WHERE pid=%s AND locktype='advisory' AND classid=1932540804::oid AND objid=1::oid AND objsubid=2 AND granted)",
               (state["backendPid"],)) != [(True,)]:
            raise ValueError("JOINT_ENROLLMENT_LOCK_NOT_HELD")
    finally:
        connection.close()
    return {"status": "enrollment_held", "boundedSeconds": 120, "productionChanged": False}


def hold_enrollment():
    if Path("/data/joint-enrollment-hold.json").exists() or Path("/data/joint-enrollment-release.json").exists():
        raise ValueError("JOINT_ENROLLMENT_HOLD_ALREADY_USED")
    cfg = json.loads(PRIVATE.read_text())
    connection = connect("csm_synapse", "csm_synapse")
    try:
        # Actual provider preparation/binding takes this same lock; SELECT-only
        # cap/inspect remains real and available. No provider hook is added.
        sql(connection, "SET lock_timeout='5s'")
        sql(connection, "SELECT pg_advisory_lock(1932540804,1)")
        for table in ("cop_account_erasure_v2.operations", "cop_account_erasure_approved.prepared_operation"):
            if sql(connection, "SELECT count(*) FROM " + table + " WHERE user_id=%s", (principal(cfg["subjects"]["a"]),)) != [(0,)]:
                raise ValueError("JOINT_PROVIDER_ENROLLMENT_ALREADY_STARTED")
        private_write(Path("/data/joint-enrollment-hold.json"), {"backendPid": sql(connection, "SELECT pg_backend_pid()")[0][0]})
        deadline = time.monotonic() + 120
        while not Path("/data/joint-enrollment-release.json").exists() and time.monotonic() < deadline:
            time.sleep(.1)
    finally:
        connection.close()


def release_enrollment():
    enrollment_status()
    private_write(Path("/data/joint-enrollment-release.json"), {"release": True})
    deadline = time.monotonic() + 5
    while True:
        try:
            enrollment_status()
        except ValueError as error:
            if str(error) == "JOINT_ENROLLMENT_LOCK_NOT_HELD":
                break
            raise
        if time.monotonic() >= deadline:
            raise ValueError("JOINT_ENROLLMENT_RELEASE_UNPROVEN")
        time.sleep(.1)
    print(json.dumps({"status": "enrollment_released", "productionChanged": False}))


def crash_ready():
    enrollment_status()
    cfg = json.loads(PRIVATE.read_text())
    owner = cfg["subjects"]["a"]
    key = hmac.new(base64.b64decode(cfg["root"], validate=True), b"messaging-erasure-owner-mac-key-v1\0", hashlib.sha256).digest()
    body = "\0".join((IDS["guard"], IDS["metadata"], cfg["issuer"], owner)).encode()
    owner_mac = hmac.new(key, b"messaging-erasure-owner-mac-v1\0" + body, hashlib.sha256).hexdigest()
    guard, metadata, provider = connect(cfg["guardDatabase"]), connect(cfg["metadataDatabase"]), connect("csm_synapse")
    try:
        deadline = time.monotonic() + 20
        while True:
            entries = sql(guard, "SELECT sequence,operation_id::text,scope_version,digest,requested_at FROM messaging_safety_v2.journal WHERE owner_mac=%s AND provider_principal=%s",
                          (owner_mac, principal(owner)))
            local = sql(metadata, "SELECT m.journal_sequence,f.operation_id::text,f.scope_version,f.journal_digest,f.requested_at FROM messaging_erasure_v2.fences f JOIN messaging_erasure_v2.journal_mirror m ON m.owner_mac=%s AND m.operation_id=f.operation_id AND m.journal_digest=f.journal_digest AND m.scope_version=f.scope_version AND m.requested_at=f.requested_at WHERE f.owner_id=%s AND f.issuer=%s",
                        (owner_mac, owner, cfg["issuer"]))
            persisted = sql(metadata, "SELECT payload->'fences'->%s FROM public.csm_messaging_stores WHERE store_name='account_safety'", (owner,))
            if len(entries) == 1 and entries == local and len(persisted) == 1 and isinstance(persisted[0][0], dict):
                value, entry = persisted[0][0], entries[0]
                if value.get("issuer") == cfg["issuer"] and value.get("operationId") == entry[1] and value.get("scopeVersion") == entry[2]:
                    break
            if time.monotonic() >= deadline:
                raise ValueError("JOINT_DURABLE_LOCAL_FENCE_UNPROVEN")
            time.sleep(.1)
        for table in ("cop_account_erasure_v2.operations", "cop_account_erasure_approved.prepared_operation"):
            if sql(provider, "SELECT count(*) FROM " + table + " WHERE user_id=%s", (principal(owner),)) != [(0,)]:
                raise ValueError("JOINT_PROVIDER_ENROLLMENT_NOT_ZERO")
        enrollment_status()
        print(json.dumps({"status": "crash_ready", "actualGuardJournalDurable": True,
            "actualLocalFenceDurable": True, "actualRevocationPayloadDurable": True,
            "providerPreparedOperations": 0, "providerBoundOperations": 0,
            "productionChanged": False, "wholeCopAccepted": False}))
    finally:
        guard.close()
        metadata.close()
        provider.close()


def assert_unenrolled():
    enrollment_status()
    cfg = json.loads(PRIVATE.read_text())
    holder = json.loads(Path("/data/joint-enrollment-hold.json").read_text())["backendPid"]
    connection = connect("csm_synapse")
    try:
        deadline = time.monotonic() + 5
        while sql(connection, "SELECT count(*) FROM pg_stat_activity WHERE datname='csm_synapse' AND usename='csm_synapse' AND pid<>%s", (holder,)) != [(0,)]:
            if time.monotonic() >= deadline:
                raise ValueError("JOINT_PROVIDER_CONNECTIONS_NOT_QUIESCED")
            time.sleep(.1)
        for table in ("cop_account_erasure_v2.operations", "cop_account_erasure_approved.prepared_operation"):
            if sql(connection, "SELECT count(*) FROM " + table + " WHERE user_id=%s", (principal(cfg["subjects"]["a"]),)) != [(0,)]:
                raise ValueError("JOINT_PROVIDER_ENROLLMENT_NOT_ZERO")
        print(json.dumps({"status": "provider_unenrolled_quiesced", "actualProviderRuntimeConnections": 0,
                          "providerPreparedOperations": 0, "providerBoundOperations": 0,
                          "productionChanged": False}))
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        actions = {"--bootstrap": bootstrap, "--bootstrap-clean": lambda: bootstrap(clean=True),
            "--seed-admitted-native": seed_admitted_native, "--seed-messaging": seed_messaging,
            "--verify-preserved": verify_preserved, "--hold-enrollment": hold_enrollment,
            "--enrollment-status": lambda: print(json.dumps(enrollment_status())),
            "--release-enrollment": release_enrollment, "--crash-ready": crash_ready,
            "--assert-unenrolled": assert_unenrolled}
        if len(sys.argv) != 2 or sys.argv[1] not in actions:
            raise ValueError("JOINT_FIXED_ACTION_REQUIRED")
        actions[sys.argv[1]]()
    except Exception as error:
        # No raw SQL, body, credentials or account identity reaches stdout.
        code = str(error) if re.fullmatch(r"JOINT_[A-Z_]{1,75}", str(error)) else "JOINT_BOOTSTRAP_FAILED"
        state = getattr(error, "pgcode", None)
        state = state if isinstance(state, str) and re.fullmatch(r"[0-9A-Z]{5}", state) else None
        name = type(error).__name__
        name = name if re.fullmatch(r"[A-Za-z_]{1,80}", name) else "UnclassifiedException"
        frames, trace = [], error.__traceback__
        while trace:
            if Path(trace.tb_frame.f_code.co_filename).name == "messaging_approved_joint_credential_v4_synapse.py":
                frames.append({"line": trace.tb_lineno, "function": trace.tb_frame.f_code.co_name})
            trace = trace.tb_next
        print(json.dumps({"status": "failed", "code": code, "sqlState": state,
                          "componentStage": BOOTSTRAP_STAGE, "exceptionClass": name,
                          "sourceFrames": frames[-8:],
                          "productionChanged": False}))
        raise SystemExit(1)
