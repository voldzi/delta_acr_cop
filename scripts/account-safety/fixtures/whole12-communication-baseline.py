"""Actual three-database enrollment for one fresh isolated whole12 namespace.
The parent must freshly pause its exact native writer before sending commit.
This is actual Docker writer closure, never production Root admission.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import uuid
import psycopg2

SOURCE = Path('/data/source')
OWNER = 'cop-clean-whole12-9aff26e65b74'
ISSUER = 'https://cop-erasure-keycloak.invalid/realms/cop'


def need(value, code='WHOLE12_BASELINE_UNPROVEN'):
    if not value: raise RuntimeError(code)


def main():
    packet = json.loads(sys.stdin.buffer.readline(131073))
    need(packet.get('contractVersion') == 'cop-clean-whole12-baseline-private-v1'
         and packet.get('owner') == OWNER, 'WHOLE12_BASELINE_PRIVATE_SCOPE')
    cfg, private = packet['configuration'], packet['credentials']
    need(cfg['fixtureOwner'] == OWNER and cfg['issuer'] == ISSUER
         and cfg['metadataDatabase'] == 'csm_messaging', 'WHOLE12_BASELINE_IDENTITY_SCOPE')
    path = SOURCE/'deploy/account-safety/communication_usage_enrollment.py'
    spec = importlib.util.spec_from_file_location('actual_usage_enrollment', path)
    op = importlib.util.module_from_spec(spec); spec.loader.exec_module(op)
    connections = [psycopg2.connect(host='haproxy.home.cz', hostaddr='127.0.0.1', port=5000,
                    dbname='cop_account_safety_guard', user='fixture_admin',
                    password=private['fixtureAdminPassword'], sslmode='verify-full',
                    sslrootcert='/fixture-ca.pem', connect_timeout=5)]
    prepared = None
    try:
        connections.extend(psycopg2.connect(host='127.0.0.1', port=5432, dbname=db,
                            user='owned_fixture_admin', connect_timeout=5) for db in ['csm_messaging','csm_synapse'])
        for index, c in enumerate(connections):
            q = c.cursor()
            q.execute("SET log_statement='none';SET log_min_error_statement='panic';SET log_parameter_max_length=0;SET log_parameter_max_length_on_error=0")
            q.execute("SELECT current_setting('cluster_name')")
            need(q.fetchone() == (('sim_whole12_tls_fixture_v1' if index == 0 else 'messaging_approved_joint_fixture'),),
                 'WHOLE12_BASELINE_CLUSTER_SCOPE')
            c.commit()
        ids = cfg['ids']
        binding = {'guardStoreId':ids['guard'], 'metadataStoreId':ids['metadata'],
            'metadataIncarnationId':ids['metadataIncarnation'], 'metadataRestoreGeneration':1,
            'providerStoreId':ids['provider'], 'providerIncarnationId':ids['providerIncarnation'],
            'providerRestoreGeneration':1, 'identityBindingDigest':op.digest([ISSUER,cfg['clientIds']]),
            'issuer':ISSUER, 'serverName':'cop-erasure.invalid',
            'ownerKeyFingerprint':cfg['ownerKeyFingerprint'],
            'retentionPolicyDigest':'0a6fc9bdcbbff0c5f31f46326974cf92f2ba7558ac72067f2f1af86d3675149d',
            'providerScopeDigest':cfg['providerScopeDigest']}
        files = ['deploy/account-safety/communication_usage_enrollment.py',
            'deploy/account-safety/006_communication_usage.sql',
            'deploy/synapse/first_use_native_inventory.py',
            'deploy/synapse/cop_account_erasure_full_v2_credential_candidate.py']
        pins = {name:hashlib.sha256((SOURCE/name).read_bytes()).hexdigest() for name in files}
        plan = {'contractVersion':'cop-messaging-usage-enrollment-plan-v1', 'mode':'initial',
            'baselineId':str(uuid.uuid4()), 'binding':binding, 'sourcePins':pins,
            'writerInventorySha256':packet['writerInventorySha256'], 'lineage':[],
            'guardRuntimeRole':'messaging_safety_v2_runtime'}
        prepared = op.PreparedEnrollment(connections,SOURCE,plan,cfg['root'])
        print(json.dumps({'phase':'prepared','nonce':prepared.nonce,
            'planSha256':prepared.summary['planSha256'],
            'writerInventorySha256':plan['writerInventorySha256']}),flush=True)
        authorization = json.loads(sys.stdin.buffer.readline(4097))
        result = prepared.commit(authorization)
        need(result['committed'] is True and result['writerClosureVerified'] is False)
        print(json.dumps({'phase':'whole12_actual_communication_baseline_enrolled',
            'knownOwners':result['knownOwners'], 'fixedServiceExclusions':result['fixedServiceExclusions'],
            'baselineDigest':result['baselineDigest'], 'actualProductionRootAdmission':False,
            'productionTouched':False,'wholeAccountAccepted':False}),flush=True)
    finally:
        if prepared: prepared.close()
        for c in connections: c.close()


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        code = str(error)
        if not code.startswith(('WHOLE12_','COMMUNICATION_')) or not code.replace('_','').isalnum():
            code = 'WHOLE12_BASELINE_FAILED'
        frames=[]; trace=error.__traceback__
        while trace:
            name=Path(trace.tb_frame.f_code.co_filename).name
            if name in {'whole12-communication-baseline.py','communication_usage_enrollment.py','first_use_native_inventory.py'}:
                frames.append({'file':name,'line':trace.tb_lineno,'function':trace.tb_frame.f_code.co_name})
            trace=trace.tb_next
        print(json.dumps({'phase':'whole12_baseline_not_ready','code':code,'sourceFrames':frames[-8:],
            'productionTouched':False,'wholeAccountAccepted':False}),flush=True)
        sys.exit(2)
