"""Destructive boundary tests only; not a production/storage acceptance report."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('s3_reset', Path(__file__).parents[1]/'account-safety/clean-reset-s3.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def listing(contents='', tail='', truncated='false'):
    return ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            '<Name>cop-community-media</Name><IsTruncated>'+truncated+'</IsTruncated>'+
            contents+tail+'</ListBucketResult>').encode()


ROW = '<Contents><Key>community-reports/test/a&amp;b</Key><Size>12</Size><ETag>abc</ETag></Contents>'


class Boundary(unittest.TestCase):
    def test_known_bucket_and_exact_keys_are_preserved(self):
        rows, token = m.objects(listing(ROW))
        self.assertEqual(rows, [{'key':'community-reports/test/a&b', 'bytes':12, 'etag':'abc'}])
        self.assertIsNone(token)

    def test_unknown_bucket_ambiguity_and_duplicate_objects_are_rejected(self):
        for raw in [listing(ROW).replace(b'cop-community-media',b'other-bucket'),
                    listing(ROW, '<Name>other-bucket</Name>'), listing(ROW+ROW),
                    listing(ROW.replace('<Size>12</Size>', '<Size>12</Size><Size>13</Size>'))]:
            with self.assertRaises(RuntimeError): m.objects(raw)

    def test_versioning_enabled_suspended_and_unknown_are_not_deletable(self):
        m.unversioned(b'<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>')
        for state in ['Enabled', 'Suspended', 'Unknown']:
            with self.assertRaisesRegex(RuntimeError, 'VERSIONING_UNSUPPORTED'):
                m.unversioned(('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                    '<Status>'+state+'</Status></VersioningConfiguration>').encode())

    def test_entities_and_oversized_xml_are_rejected(self):
        for raw in [b'<!DOCTYPE test [<!ENTITY t SYSTEM "file:///etc/passwd">]>'+listing(), b'x'*1048577]:
            with self.assertRaisesRegex(RuntimeError, 'XML_UNSAFE'): m.objects(raw)

    def test_incomplete_page_needs_a_continuation_token(self):
        with self.assertRaisesRegex(RuntimeError, 'PAGINATION_UNPROVEN'):
            m.objects(listing(ROW, truncated='true'))
        self.assertEqual(m.objects(listing(ROW, '<NextContinuationToken>next</NextContinuationToken>', 'true'))[1], 'next')

    def test_subset_unknown_fields_and_path_traversal_cannot_authorize_deletion(self):
        for raw in [listing(ROW, '<Prefix>some-subset/</Prefix>'), listing(ROW,'<KeyCount>0</KeyCount>'),
                    listing('', '<CommonPrefixes><Prefix>hidden/</Prefix></CommonPrefixes>'),
                    listing(ROW.replace('community-reports/test/a&amp;b','../other-bucket/file'))]:
            with self.assertRaises(RuntimeError): m.objects(raw)

    def test_inventory_uses_every_page_and_rejects_repeated_tokens(self):
        client = m.S3({'accessKeyId':'synthetic', 'secretAccessKey':'synthetic'})
        version = b'<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>'
        with patch.object(client, 'request', side_effect=[(200, version),
             (200, listing(ROW, '<NextContinuationToken>x</NextContinuationToken>', 'true')),
             (200, listing())]):
            self.assertEqual(len(client.inventory()), 1)
        with patch.object(client, 'request', side_effect=[(200, version),
             (200, listing('', '<NextContinuationToken>x</NextContinuationToken>', 'true')),
             (200, listing('', '<NextContinuationToken>x</NextContinuationToken>', 'true'))]):
            with self.assertRaisesRegex(RuntimeError, 'PAGINATION_REPEATED'): client.inventory()

    def test_dependency_failure_does_not_become_empty_inventory(self):
        client = m.S3({'accessKeyId':'synthetic', 'secretAccessKey':'synthetic'})
        for status in [401, 403, 429, 500, 503]:
            with patch.object(client, 'request', return_value=(status, b'')):
                with self.assertRaisesRegex(RuntimeError, 'VERSIONING_UNAVAILABLE'): client.inventory()


if __name__ == '__main__': unittest.main()
