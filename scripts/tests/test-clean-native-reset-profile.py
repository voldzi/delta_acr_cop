"""The complete reviewed classification bytes, not embedded labels, are authority."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).parents[1]/'account-safety'
spec=importlib.util.spec_from_file_location('native_reset_profile',ROOT/'clean-reset-messaging.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class Bytes:
    def __init__(self,raw):self.raw=raw
    def read_bytes(self):return self.raw


class ProfileBoundary(unittest.TestCase):
    def test_exact_reviewed_profile_is_accepted(self):
        self.assertIn('server_keys_json',m.profile()['configurationTables'])

    def test_reclassification_with_same_count_and_claimed_export_is_rejected(self):
        profile=json.loads((ROOT/'native94-reset-profile.json').read_bytes())
        profile['configurationTables'].remove('server_keys_json')
        profile['dataTables'].append('server_keys_json')
        self.assertEqual(len(profile['configurationTables'])+len(profile['dataTables']),173)
        with patch.object(m,'PROFILE',Bytes(json.dumps(profile).encode())):
            with self.assertRaisesRegex(RuntimeError,'PROFILE_BYTES_CHANGED'):m.profile()


if __name__=='__main__':unittest.main()
