#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run on the host actually running Synapse. No migration, user rows, tokens,
# configuration values, provider requests, restart or privilege changes.
container=${1:-}
if [[ -z "$container" ]]; then
  mapfile -t candidates < <(docker ps --filter name=synapse --format '{{.ID}}')
  [[ ${#candidates[@]} -eq 1 ]] || { echo 'Select exactly one running Synapse container ID.' >&2; exit 2; }
  container=${candidates[0]}
fi
[[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || { echo 'Invalid container ID.' >&2; exit 2; }
docker inspect --format 'container={{.Name}} image={{.Image}} running={{.State.Running}}' "$container"
docker exec -i "$container" python - <<'PY'
import json, os, sys
try:
    import yaml, synapse, psycopg2
    args = open('/proc/1/cmdline', 'rb').read().decode().split('\0')
    paths = []
    for i, arg in enumerate(args):
        if arg in ('--config-path', '-c') and i + 1 < len(args): paths.append(args[i+1])
        elif arg.startswith('--config-path='): paths.append(arg.split('=',1)[1])
    if len(paths) > 1: raise RuntimeError('multiple_config_files_require_review')
    path = paths[0] if paths else os.environ.get('SYNAPSE_CONFIG_PATH', '/data/homeserver.yaml')
    with open(path) as handle: config = yaml.safe_load(handle)
    db = config.get('database', {})
    if db.get('name') != 'psycopg2': raise RuntimeError('postgresql_required_for_this_inspection')
    allowed = {'user','password','database','dbname','host','port','sslmode','sslrootcert','sslcert','sslkey'}
    connect = {k:v for k,v in db.get('args',{}).items() if k in allowed}
    connect['options'] = '-c default_transaction_read_only=on -c statement_timeout=5000'
    conn = psycopg2.connect(**connect)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute('SELECT current_database(),current_user,current_setting(\'server_version_num\')')
    database, role, version = cur.fetchone()
    cur.execute('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    rights = dict(zip(['superuser','createDatabase','createRole','replication','bypassRls'], cur.fetchone()))
    cur.execute("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name ~ '(user|account|device|token|e2e|pusher|profile|threepid|signature|cross_signing|consent)' ORDER BY table_name,ordinal_position")
    columns = [{'table':t,'column':c,'type':d} for t,c,d in cur.fetchall()]
    cur.execute("SELECT c.conname,c.conrelid::regclass::text,pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.conrelid::regclass::text ~ '(user|account|device|token|e2e|pusher|profile|threepid|signature|cross_signing|consent)' ORDER BY 2,1")
    constraints = [{'name':n,'table':t,'definition':d} for n,t,d in cur.fetchall()]
    print(json.dumps({'synapseVersion':getattr(synapse,'__version__','unknown'),'database':database,'connectedRole':role,
      'postgresVersionNumber':version,'roleRights':rights,'columns':columns,'constraints':constraints,
      'userRowsRead':False,'providerCalls':False,'productionChanged':False},indent=2))
    cur.close(); conn.close()
except Exception as exc:
    # Driver errors may contain connection strings. Never print exception text.
    print(json.dumps({'inspection':'unavailable','errorClass':type(exc).__name__,'userRowsRead':False,'productionChanged':False}),file=sys.stderr)
    sys.exit(2)
PY
