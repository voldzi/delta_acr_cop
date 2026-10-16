#!/usr/bin/env python3
"""Offline immutable Edge release validation; no Docker or production contact."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('edge_release',Path(__file__).resolve().parents[1]/'cop-edge-release.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def config():
    return {'services': {'cop-edge': {'environment': {'COP_EDGE_NODE_ID': 'existing-node'},
                                     'networks': {'default': {}},
                                     'volumes': [{'type': 'volume', 'source': 'edge-data', 'target': '/data/edge'}]}},
            'volumes': {'edge-data': {'name': 'cop_cop-edge-data'}}, 'networks': {'default': {'name': 'cop_default'}}}


def current():
    return {'Id': 'a'*64, 'Image': 'sha256:'+'b'*64,
            'Config': {'Env': ['NODE_VERSION=24', 'COP_EDGE_NODE_ID=existing-node'],
                       'Labels': {'com.docker.compose.project': 'cop', 'com.docker.compose.service': 'cop-edge'}},
            'State': {'Running': True, 'Paused': False, 'Pid': 123, 'StartedAt': 'existing'},
            'HostConfig': {},
            'Mounts': [{'Type': 'volume', 'Name': 'cop_cop-edge-data', 'Source': '/existing/volume',
                        'Destination': '/data/edge', 'RW': True}],
            'NetworkSettings': {'Networks': {'cop_default': {'NetworkID': 'c'*64}}}}


class EdgeRelease(unittest.TestCase):
    def test_image_requires_immutable_id_and_exact_source_label(self):
        image='sha256:'+'a'*64; revision='b'*40
        value={'Id': image, 'Config': {'Labels': {'org.opencontainers.image.revision': revision}}}
        m.verify_image(value,image,revision)
        for wrong in ['edge:local','sha256:'+'c'*64]:
            with self.assertRaises(RuntimeError):m.verify_image(value,wrong,revision)
        with self.assertRaises(RuntimeError):m.verify_image(value,image,'c'*40)

    def test_actual_named_volume_identity_is_required(self):
        c=current(); desired=m.desired_runtime(config(),c)
        self.assertEqual(desired['volumes'][0]['source'],'/existing/volume')
        c['Mounts'][0]['Name']='other-data'
        with self.assertRaisesRegex(RuntimeError,'edge_volume_identity_changed'):m.desired_runtime(config(),c)

    def test_environment_and_runtime_parity_are_actual_checks(self):
        seen=[]
        m.validate_runtime(current(),config(),{'Env':['NODE_VERSION=24']},lambda *args:seen.append(args))
        self.assertEqual(len(seen),1)
        c=current();c['Config']['Env'].append('FOREIGN=private')
        with self.assertRaisesRegex(RuntimeError,'edge_environment_drift'):m.validate_runtime(c,config(),{'Env':['NODE_VERSION=24']},lambda *args:None)
        def deny(*args):raise RuntimeError('actual_host_drift')
        with self.assertRaisesRegex(RuntimeError,'actual_host_drift'):m.validate_runtime(current(),config(),{'Env':['NODE_VERSION=24']},deny)

    def test_foreign_service_stopped_paused_or_network_changed_is_denied(self):
        mutations=[lambda c:c['Config']['Labels'].update({'com.docker.compose.service':'other'}),
                   lambda c:c['State'].update(Running=False),lambda c:c['State'].update(Paused=True),
                   lambda c:c['NetworkSettings'].update(Networks={'other':{'NetworkID':'c'*64}})]
        for edit in mutations:
            c=current();edit(c)
            with self.assertRaises(RuntimeError):m.validate_runtime(c,config(),{'Env':['NODE_VERSION=24']},lambda *args:None)

    def test_mount_and_actual_network_id_preservation(self):
        c=current();m.preserve(c,copy.deepcopy(c))
        for edit in [lambda v:v['Mounts'][0].update(Source='/foreign'),
                     lambda v:v['Mounts'][0].update(RW=False),
                     lambda v:v['NetworkSettings']['Networks']['cop_default'].update(NetworkID='d'*64)]:
            changed=copy.deepcopy(c);edit(changed)
            with self.assertRaises(RuntimeError):m.preserve(c,changed)

    def test_process_witness_ignores_health_timing_but_not_cid_pid_or_config(self):
        c=current();value=copy.deepcopy(c);value['State']['Health']={'Log':[{'End':'new'}]}
        self.assertEqual(m.container_witness(c),m.container_witness(value))
        for edit in [lambda v:v.update(Id='d'*64),lambda v:v['State'].update(Pid=124),
                     lambda v:v['Config']['Env'].append('OTHER=changed')]:
            value=copy.deepcopy(c);edit(value)
            self.assertNotEqual(m.container_witness(c),m.container_witness(value))

    def test_duplicate_environment_is_not_last_wins(self):
        with self.assertRaisesRegex(RuntimeError,'edge_environment_duplicate'):m.environment({'Env':['A=a','A=b']})


if __name__=='__main__':unittest.main()
