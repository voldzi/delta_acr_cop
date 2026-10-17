"""Finite pre-release COP messaging reset. Root admission is required for apply.
No HTTP/CLI, credentials on disk, native schema deletion or provider privilege
change. Retains only the existing fixed bot and configured admin credential.
"""
import hashlib
import json
from pathlib import Path
import re

PROFILE = Path(__file__).with_name('native94-reset-profile.json')
SERVICE = 'cop.ai.agent'
STORES = {'account_erasure_jobs', 'account_safety', 'conversations', 'devices',
          'matrix_identities', 'mobility_effects_erasure', 'notifications'}
COLUMNS = """SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r'
AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum"""


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def canonical_principal(server):
    return '@cop_cop.ai.agent_a83479e9281a:' + server


def profile():
    raw = PROFILE.read_bytes()
    p = json.loads(raw)
    need(p['contractVersion'] == 'cop-native-clean-reset-profile-v1' and p['schemaVersion'] == 94
         and len(p['configurationTables']) + len(p['dataTables']) == p['publicTableCount']
         and p['publicTableCount'] == 173 and p['sourceExportSha256'] ==
         '00bd048810b06cc8224242fb8289021472f8b4bf37352fe512e66d8fc99b656f', 'RESET_NATIVE_PROFILE_INVALID')
    return p


def begin(c, database, readonly=False):
    q = c.cursor()
    q.execute('BEGIN READ ONLY' if readonly else 'BEGIN')
    q.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'")
    q.execute("SET LOCAL log_statement='none'; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1; SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0")
    q.execute('SELECT current_database()')
    need(q.fetchone()[0] == database, 'RESET_MESSAGING_DATABASE_MISMATCH')
    return q


def native_snapshot(q, token, server):
    p = profile()
    need(isinstance(server, str) and re.fullmatch(r'[a-z0-9.-]{1,253}', server)
         and isinstance(token, str) and 20 <= len(token) <= 16384, 'RESET_NATIVE_CONFIG_INVALID')
    q.execute('SELECT version FROM schema_version')
    need(q.fetchall() == [(94,)], 'RESET_NATIVE_SCHEMA_VERSION')
    q.execute(COLUMNS)
    columns = q.fetchall()
    need(hashlib.sha256(json.dumps(columns, separators=(',', ':')).encode()).hexdigest() == p['publicColumnsDigest']
         and sorted({r[0] for r in columns}) == sorted(p['configurationTables'] + p['dataTables']), 'RESET_NATIVE_SCHEMA_DRIFT')
    for table in p['requiredEmptyTables']:
        q.execute('SELECT count(*) FROM public.' + table)
        need(q.fetchone()[0] == 0, 'RESET_NATIVE_BACKGROUND_WORK_PENDING')
    for relation in p['requiredEmptyRelations']:
        need(re.fullmatch(r'cop_[a-z0-9_]+\.[a-z_]+', relation), 'RESET_NATIVE_RELATION_SCOPE')
        q.execute('SELECT to_regclass(%s) IS NOT NULL', (relation,))
        if q.fetchone()[0]:
            q.execute('SELECT count(*) FROM '+relation)
            need(q.fetchone()[0] == 0, 'RESET_NATIVE_ACCEPTED_OPERATION_PRESENT')
    q.execute('SELECT user_id FROM public.access_tokens WHERE token=%s', (token,))
    found = q.fetchall()
    need(len(found) == 1, 'RESET_NATIVE_ADMIN_CREDENTIAL_UNPROVEN')
    admin = found[0][0]
    q.execute('SELECT name,admin,deactivated FROM public.users ORDER BY name')
    users = q.fetchall()
    principal = canonical_principal(server)
    need(any(x[0] == admin and x[1] == 1 and x[2] == 0 for x in users)
         and any(x[0] == principal and x[2] == 0 for x in users), 'RESET_NATIVE_SERVICE_MISSING')
    need(not admin.startswith('@cop_') and all(x[0] == admin or
         x[0].startswith('@cop_') and x[0].endswith(':' + server) for x in users), 'RESET_FOREIGN_NATIVE_ACCOUNT')
    q.execute('SELECT count(*) FROM public.room_memberships WHERE NOT(user_id=ANY(%s))', ([x[0] for x in users],))
    need(q.fetchone()[0] == 0, 'RESET_FOREIGN_ROOM_MEMBER')
    # Hash credentials on the DB server; only the aggregate digest is returned.
    q.execute("SELECT encode(sha256(convert_to(string_agg(to_jsonb(u)::text,'' ORDER BY name),'UTF8')),'hex') FROM users u WHERE name=ANY(%s)", ([admin, principal],))
    service_fingerprint = q.fetchone()[0]
    counts = {}
    for table in p['dataTables']:
        q.execute('SELECT count(*) FROM public.' + table)
        counts[table] = q.fetchone()[0]
    config = {}
    for table in p['configurationTables']:
        q.execute("SELECT count(*),encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT to_jsonb(t)::text h FROM public." + table + ' t) s')
        config[table] = list(q.fetchone())
    public = {'contractVersion': 'cop-native-clean-reset-plan-v1', 'schemaDigest': p['publicColumnsDigest'],
              'serverName': server, 'humanCount': len(users)-2, 'counts': counts,
              'configuration': config, 'preservedServiceFingerprint': service_fingerprint}
    return {**public, 'planDigest': digest(public)}, admin


def inspect_native_reset(connection, admin_token, server_name):
    try:
        q = begin(connection, 'csm_synapse', True)
        return native_snapshot(q, admin_token, server_name)[0]
    finally:
        connection.rollback()


def _rows(q, table, condition, values):
    q.execute('SELECT * FROM public.' + table + ' WHERE ' + condition, values)
    names = [x[0] for x in q.description]
    return names, q.fetchall()


def _restore(q, table, snapshot):
    names, rows = snapshot
    if rows:
        need(all(re.fullmatch(r'[a-z_][a-z0-9_]*', n) for n in names), 'RESET_NATIVE_COLUMN_INVALID')
        group = '(' + ','.join(['%s']*len(names)) + ')'
        q.execute('INSERT INTO public.' + table + '(' + ','.join('"'+n+'"' for n in names)
                  + ') VALUES' + ','.join([group]*len(rows)), tuple(v for row in rows for v in row))


def apply_native_reset(connection, reviewed_plan, admin_token, server_name, admission):
    admission.assert_current()
    try:
        q = begin(connection, 'csm_synapse')
        p = profile()
        q.execute('LOCK TABLE ' + ','.join('public.' + x for x in sorted(p['configurationTables'] + p['dataTables'])) + ' IN ACCESS EXCLUSIVE MODE')
        before, admin = native_snapshot(q, admin_token, server_name)
        need(before == reviewed_plan, 'RESET_NATIVE_PLAN_DRIFT')
        service = canonical_principal(server_name)
        kept = {'users': _rows(q, 'users', 'name=ANY(%s)', ([admin, service],)),
                'devices': _rows(q, 'devices', 'user_id=%s', (admin,)),
                'refresh_tokens': _rows(q, 'refresh_tokens', 'user_id=%s', (admin,)),
                'access_tokens': _rows(q, 'access_tokens', 'token=%s', (admin_token,))}
        # Admin device bindings needed by its configured token survive, but old
        # client IP, user-agent and last-seen observations do not.
        names, rows = kept['devices']
        kept['devices'] = (names, [tuple(None if n in {'ip','user_agent','last_seen','display_name'} else r[i]
                                         for i,n in enumerate(names)) for r in rows])
        need(all(len(rows) <= 100 for _,rows in kept.values()), 'RESET_NATIVE_CREDENTIAL_LIMIT')
        q.execute('TRUNCATE TABLE ' + ','.join('public.' + x for x in p['dataTables']))
        for table in ['users', 'devices', 'refresh_tokens', 'access_tokens']:
            _restore(q, table, kept[table])
        after, _ = native_snapshot(q, admin_token, server_name)
        need(after['humanCount'] == 0 and after['configuration'] == before['configuration']
             and after['preservedServiceFingerprint'] == before['preservedServiceFingerprint'], 'RESET_NATIVE_READBACK_FAILED')
        allowed = {'users','devices','refresh_tokens','access_tokens'}
        need(all(n == 0 for t,n in after['counts'].items() if t not in allowed), 'RESET_NATIVE_DATA_REMAIN')
        for table, (_,rows) in kept.items():
            need(after['counts'][table] == len(rows), 'RESET_NATIVE_CREDENTIAL_READBACK_FAILED')
        admission.assert_current()
        connection.commit()
        return {'contractVersion': 'cop-native-clean-reset-result-v1', 'removedHumanCount': before['humanCount'],
                'configurationPreserved': True, 'serviceCredentialsPreserved': True,
                'remainingHumanCount': 0, 'oldDataBackupCreated': False, 'wholeAccountComplete': False}
    except BaseException:
        connection.rollback()
        raise


def metadata_snapshot(q, server):
    q.execute('SELECT store_name,payload FROM public.csm_messaging_stores ORDER BY store_name')
    values = q.fetchall()
    need(set(k for k,_ in values) <= STORES, 'RESET_UNKNOWN_MESSAGING_STORE')
    payloads = dict(values)
    identities = payloads.get('matrix_identities', {}).get('identities')
    need(isinstance(identities, dict), 'RESET_MESSAGING_IDENTITIES_UNPROVEN')
    matches = [(key,row) for key,row in identities.items() if row.get('csmUserId') == SERVICE]
    need(len(matches) == 1 and matches[0][1].get('matrixUserId') == canonical_principal(server)
         and matches[0][1].get('serverName') == server and 'password' in matches[0][1], 'RESET_MESSAGING_FIXED_SERVICE_UNPROVEN')
    safety = payloads.get('account_safety', {})
    need(safety.get('version') == 1 and all(isinstance(safety.get(k),dict) for k in ['fences','jizdaFences','bindings'])
         and not safety.get('fences') and not safety.get('jizdaFences')
         and not payloads.get('account_erasure_jobs', {}).get('jobs'), 'RESET_MESSAGING_ACCEPTED_OPERATION_PRESENT')
    safe = {'contractVersion':'cop-messaging-clean-reset-plan-v1','storeCounts':{k:len(json.dumps(v)) for k,v in values},
            'serviceMappingDigest':digest({k:v for k,v in matches[0][1].items() if k!='password'}),
            'metadataDigest':digest(payloads)}
    return {**safe,'planDigest':digest(safe)}, matches[0]


def inspect_metadata_reset(connection, server_name):
    try:
        q = begin(connection, 'csm_messaging', True)
        return metadata_snapshot(q, server_name)[0]
    finally:
        connection.rollback()


def apply_metadata_reset(connection, reviewed_plan, server_name, admission):
    admission.assert_current()
    try:
        q = begin(connection, 'csm_messaging')
        q.execute('LOCK TABLE public.csm_messaging_stores IN ACCESS EXCLUSIVE MODE')
        before, service = metadata_snapshot(q, server_name)
        need(before == reviewed_plan, 'RESET_MESSAGING_PLAN_DRIFT')
        # There is no cross-user reconstruction: only the same original fixed
        # encrypted service mapping is retained; ordinary stores load defaults.
        fresh = {'version':1,'identities':{service[0]:service[1]}}
        q.execute('DELETE FROM public.csm_messaging_stores WHERE store_name<>%s', ('matrix_identities',))
        q.execute('UPDATE public.csm_messaging_stores SET payload=%s::jsonb,updated_at=now() WHERE store_name=%s',
                  (json.dumps(fresh),'matrix_identities'))
        q.execute("INSERT INTO public.csm_messaging_stores(store_name,payload) VALUES('account_safety',%s::jsonb)",
                  (json.dumps({'version':1,'fences':{},'jizdaFences':{},'bindings':{}}),))
        after, remaining = metadata_snapshot(q, server_name)
        need(remaining == service and after['serviceMappingDigest'] == before['serviceMappingDigest']
             and set(after['storeCounts']) == {'account_safety','matrix_identities'}, 'RESET_MESSAGING_READBACK_FAILED')
        admission.assert_current()
        connection.commit()
        return {'contractVersion':'cop-messaging-clean-reset-result-v1','userStoresCleared':True,
                'originalServiceMappingPreserved':True,'oldDataBackupCreated':False,'wholeAccountComplete':False}
    except BaseException:
        connection.rollback()
        raise
