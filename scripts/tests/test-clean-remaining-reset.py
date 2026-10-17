"""Configuration boundaries only. Does not assert actual Root/provider success."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('remaining',Path(__file__).parents[1]/'account-safety/clean-remaining-reset.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def inputs():
    plans={'messaging':{'native':{},'metadata':{}},'media':{'nativeMedia':{},'s3':{}},'edge':{}}
    connections={k:{'host':'haproxy.home.cz','port':5000,'dbname':db,'user':'postgres',
        'password':'synthetic-test-only','sslmode':'verify-full',
        'sslrootcert':'/etc/vcode-cop-pgbouncer/postgres-ca.crt'} for k,db in [('native','csm_synapse'),('metadata','csm_messaging')]}
    private={'resetEpoch':'synthetic-epoch','tokensNotBefore':1,'remaining':{
        'contractVersion':'cop-clean-remaining-private-v1','connections':connections,
        'nativeAdminToken':'synthetic-admin-token-for-tests-only','reviewedPlans':plans}}
    plan={'resetEpoch':private['resetEpoch'],'tokensNotBefore':1,
          'reviewedPlanDigests':{k:m.digest(v) for k,v in plans.items()}}
    return plan,private


class Boundary(unittest.TestCase):
    def test_exact_scopes_are_admitted_as_configuration_only(self):
        plan,private=inputs()
        self.assertIs(m.validate_configuration(plan,private),private['remaining'])
        compile(m.HELPER,'finite-helper','exec')

    def test_weak_tls_other_host_database_or_role_are_rejected(self):
        for key,value in [('sslmode','disable'),('host','other.home.cz'),('port',5432),
                          ('dbname','another_app'),('user','arbitrary_role'),('sslrootcert','/tmp/other-ca')]:
            plan,private=inputs();private['remaining']['connections']['native'][key]=value
            with self.assertRaisesRegex(RuntimeError,'DATABASE_SCOPE'):m.validate_configuration(plan,private)

    def test_missing_provider_unknown_scope_and_changed_epoch_are_rejected(self):
        for mutation in [lambda p:p['remaining']['reviewedPlans'].pop('edge'),
                         lambda p:p['remaining']['connections'].update(other={}),
                         lambda p:p.update(resetEpoch='other-epoch'),
                         lambda p:p['remaining'].update(extra='not-allowed')]:
            plan,private=inputs();mutation(private)
            with self.assertRaises(RuntimeError):m.validate_configuration(plan,private)

    def test_provider_plan_change_needs_its_own_reviewed_digest(self):
        plan,private=inputs();private['remaining']['reviewedPlans']['media']['s3']['bucket']='other'
        with self.assertRaisesRegex(RuntimeError,'PLAN_DIGEST'):m.validate_configuration(plan,private)

    def test_run_cannot_skip_live_preflight(self):
        with self.assertRaisesRegex(RuntimeError,'NOT_PREFLIGHTED'):m.run_remaining_reset(object(),{})


if __name__=='__main__':unittest.main()
