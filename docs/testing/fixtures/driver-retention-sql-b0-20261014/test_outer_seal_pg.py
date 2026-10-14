"""One extra owned PG case; the frozen nine-case source/receipt stay unchanged."""
import hashlib
import importlib.util
import json
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
import unittest

sys.dont_write_bytecode=True
BASE=Path(__file__).resolve().parent
EXPECTED_SQL='40a486bc72046291ad2287a489d3688a1f2d2bbbb53f4d7202c6192de91af8cf'
EXPECTED_HELPER='17f228af8fed4735bbec52259b212ddd98302db4dd7e85cc92385c85d186f72e'
for name,pin in (('candidate.sql',EXPECTED_SQL),('test_owned_pg.py',EXPECTED_HELPER)):
    if hashlib.sha256((BASE/name).read_bytes()).hexdigest()!=pin:
        raise RuntimeError('frozen_owned_source_pin_mismatch')
spec=importlib.util.spec_from_file_location('own_pinned_helpers',BASE/'test_owned_pg.py')
own=importlib.util.module_from_spec(spec);spec.loader.exec_module(own)
NAME='cop-retention-outer-seal-b0-20261014'
FACTS={}


class ControlConnection(own.OriginConnection):
    """Fixed Root-control role, never an application-selected connection."""
    def __init__(self):
        self.process=subprocess.Popen(own.DOCKER+['exec','-i',own.CONTAINER_ID,'psql',
            '-X','-qAt','-v','ON_ERROR_STOP=1','-U',own.CONTROL,'-d',own.DATABASE],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        self.lines,self.errors=queue.Queue(),[];self.sequence=0
        threading.Thread(target=self._read,daemon=True).start()
        self.error_reader=threading.Thread(target=self._errors,daemon=True);self.error_reader.start()
        own.SESSIONS.append(self)


class OuterSealCase(unittest.TestCase):
    def test_outer_control_rollback_is_not_durable_no_effect(self):
        own.seed()
        op=own.operation(1001);own.register(op)
        origin=own.OriginConnection();desc=origin.begin();own.claim(op,desc)
        control=ControlConnection()
        rows=control.command('BEGIN; SELECT cop_retention_source.resolve_or_seal('+own.literal(op)+');')
        inner=json.loads(rows[-1]);self.assertEqual(inner['state'],'origin_no_effect_closed')
        before=own.value('postgres',"SELECT jsonb_build_object('state',state,'sealed',sealed_at IS NOT NULL) FROM cop_retention_source.origins WHERE operation_id="+own.literal(op)+';')
        self.assertEqual(before,{'state':'claimed','sealed':False})
        control.command('ROLLBACK;')
        fresh=own.value('postgres',"SELECT jsonb_build_object('state',state,'sealed',sealed_at IS NOT NULL) FROM cop_retention_source.origins WHERE operation_id="+own.literal(op)+';')
        self.assertEqual(fresh,{'state':'claimed','sealed':False})
        origin.command('SELECT cop_retention_source.expire_origin('+own.literal(op)+'); COMMIT;')
        self.assertEqual(own.resolve(op)['state'],'origin_commit_known')
        self.assertEqual(own.counts(),{'receipts':1,'intervals':1,'eta':1,'revocations':1,'fences':1})
        FACTS.update(innerJsonReportedNoEffect=True,controlTransactionRolledBack=True,
            freshReadbackStillClaimed=True,originalExecutedAfterControlRollback=True,finalOriginCommitKnown=True)

        # Contrast with the same fixed control transaction actually committing:
        # fresh readback is sealed and the still-open origin gate then denies.
        own.seed();second=own.operation(1002);own.register(second)
        paused=own.OriginConnection();second_desc=paused.begin();own.claim(second,second_desc)
        control.command('BEGIN; SELECT cop_retention_source.resolve_or_seal('+own.literal(second)+'); COMMIT;')
        sealed=own.value('postgres',"SELECT jsonb_build_object('state',state,'sealed',sealed_at IS NOT NULL) FROM cop_retention_source.origins WHERE operation_id="+own.literal(second)+';')
        self.assertEqual(sealed,{'state':'sealed_no_effect','sealed':True})
        with self.assertRaisesRegex(RuntimeError,'origin_not_claimed_for_expiry'):
            paused.command('SELECT cop_retention_source.expire_origin('+own.literal(second)+');')
        self.assertEqual(own.counts(),{'receipts':3,'intervals':3,'eta':3,'revocations':2,'fences':1})
        FACTS.update(committedControlSealReadBack=True,lateOriginDeniedAfterDurableSeal=True)


def main():
    proof={'scope':'ONE_OWNED_PG_OUTER_CONTROL_TRANSACTION_QUALIFICATION_ONLY',
        'image':own.IMAGE,'containerName':NAME,'inputPins':{'candidate.sql':EXPECTED_SQL,'test_owned_pg.py':EXPECTED_HELPER},
        'actualAuthority':False,'nativeDeliveryAccepted':False,'productionRootCompositionAccepted':False}
    created=False;result=None;fatal=None;volumes_before=[]
    try:
        own.docker('image','inspect',own.IMAGE,'--format','{{.Id}}')
        if own.docker('inspect',NAME,check=False).returncode==0:raise RuntimeError('owned_name_exists_not_adopted')
        volumes_before=own.docker('volume','ls','--format','{{.Name}}').stdout.splitlines()
        started=own.docker('run','--detach','--pull=never','--name',NAME,'--label','codex.cop.retention.fixture=20261014-outer-v1',
            '--network=none','--read-only','--user=postgres','--security-opt=no-new-privileges:true','--cap-drop=ALL',
            '--pids-limit=64','--memory=256m','--cpus=1',
            '--tmpfs','/var/lib/postgresql:rw,nosuid,nodev,mode=0700,uid=70,gid=70',
            '--tmpfs','/var/run/postgresql:rw,nosuid,nodev,mode=0777','--tmpfs','/tmp:rw,nosuid,nodev,mode=1777',
            '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB='+own.DATABASE,own.IMAGE,
            '-c','listen_addresses=','-c','max_prepared_transactions=0','-c','log_statement=none','-c','logging_collector=off')
        own.CONTAINER_ID=started.stdout.strip()
        if not re.fullmatch(r'[0-9a-f]{64}',own.CONTAINER_ID):raise RuntimeError('owned_container_id_invalid')
        created=True;deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            final=own.docker('exec',own.CONTAINER_ID,'cat','/proc/1/comm',check=False)
            ready=own.docker('exec',own.CONTAINER_ID,'pg_isready','-U','postgres','-d',own.DATABASE,check=False)
            if final.stdout.strip()=='postgres' and ready.returncode==0:break
            time.sleep(.15)
        else:raise RuntimeError('owned_postgres_not_ready')
        inspect=json.loads(own.docker('inspect',own.CONTAINER_ID).stdout)[0]
        proof['isolation']={'networkMode':inspect['HostConfig']['NetworkMode'],'readOnlyRootfs':inspect['HostConfig']['ReadonlyRootfs'],
            'ports':inspect['HostConfig']['PortBindings'],'mountTypes':[m['Type'] for m in inspect['Mounts']],
            'tmpfsPaths':sorted(inspect['HostConfig']['Tmpfs']),'globalDockerContextChanged':False}
        if proof['isolation']['networkMode']!='none' or not proof['isolation']['readOnlyRootfs'] or proof['isolation']['ports'] or any(t!='tmpfs' for t in proof['isolation']['mountTypes']):raise RuntimeError('owned_isolation_mismatch')
        own.sql('postgres',(BASE/'candidate.sql').read_text())
        own.sql('postgres',"INSERT INTO public.driver_account_erasure_fences VALUES('40000000-0000-4000-8000-000000000001');")
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OuterSealCase))
        proof['result']={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'success':result.wasSuccessful() and result.testsRun==1}
        proof['facts']=FACTS
    except BaseException as error:fatal=str(error);proof['fatal']=fatal
    finally:
        for connection in own.SESSIONS:
            try:connection.close()
            except BaseException:pass
        if created:
            try:
                own.docker('rm','--force',own.CONTAINER_ID)
                proof['ownedContainerRemoved']=own.docker('inspect',own.CONTAINER_ID,check=False).returncode!=0
            except BaseException as error:proof['cleanupError']=str(error)
        try:
            after=own.docker('volume','ls','--format','{{.Name}}').stdout.splitlines()
            proof['volumes']={'beforeCount':len(volumes_before),'afterCount':len(after),'addedCount':len(set(after)-set(volumes_before)),'removedCount':len(set(volumes_before)-set(after))}
        except BaseException as error:proof['volumeReadError']=str(error)
        proof['sourcePins']={name:hashlib.sha256((BASE/name).read_bytes()).hexdigest() for name in ('candidate.sql','test_owned_pg.py','test_outer_seal_pg.py')}
        proof['frozenInputsUnchanged']=proof['sourcePins']['candidate.sql']==EXPECTED_SQL and proof['sourcePins']['test_owned_pg.py']==EXPECTED_HELPER
        (BASE/'outer-seal-proof.json').write_text(json.dumps(proof,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'proof':str(BASE/'outer-seal-proof.json'),'result':proof.get('result'),'fatal':fatal,'ownedContainerRemoved':proof.get('ownedContainerRemoved')},sort_keys=True))
    return 0 if not fatal and result and result.wasSuccessful() and result.testsRun==1 and proof.get('ownedContainerRemoved') and proof['frozenInputsUnchanged'] else 1


if __name__=='__main__':raise SystemExit(main())
