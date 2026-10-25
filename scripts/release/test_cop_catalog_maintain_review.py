import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('review',Path(__file__).with_name('cop-catalog-maintain-review.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)


class LayerTests(unittest.TestCase):
    def archive(self,extra=None,mutate=None):
        out=io.BytesIO();files={name:b'public fixture' for name in r.FILES}
        with tarfile.open(fileobj=out,mode='w') as t:
            for name in sorted(r.DIRECTORIES|set(files)):
                m=tarfile.TarInfo(name);m.uid=m.gid=0
                if name in r.DIRECTORIES:m.type=tarfile.DIRTYPE;m.mode=0o755
                else:m.mode=0o644;m.size=len(files[name])
                if mutate:mutate(m)
                t.addfile(m,io.BytesIO(files[name]) if m.isfile() else None)
            if extra:t.addfile(extra)
        return out.getvalue(),{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}

    def check(self,raw,files):
        with patch.object(r,'LAYER_SHA',hashlib.sha256(raw).hexdigest()),patch.object(r,'FILES',files):
            r.validate_layer(raw)

    def test_only_two_files_and_unchanged_directory_metadata(self):
        self.check(*self.archive())

    def test_whiteout_denied(self):
        with self.assertRaises(AssertionError):self.check(*self.archive(extra=tarfile.TarInfo('app/.wh.server.js')))

    def test_extra_erasure_module_denied(self):
        with self.assertRaises(AssertionError):self.check(*self.archive(extra=tarfile.TarInfo('app/apps/cop-api/dist/account-erasure.js')))

    def test_symlink_denied(self):
        def mutate(m):
            if m.name.endswith('server.js'):m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';m.size=0
        with self.assertRaises(AssertionError):self.check(*self.archive(mutate=mutate))

    def test_directory_permissions_change_denied(self):
        def mutate(m):
            if m.isdir():m.mode=0o777
        with self.assertRaises(AssertionError):self.check(*self.archive(mutate=mutate))

    def test_path_escape_denied(self):
        with self.assertRaises(AssertionError):self.check(*self.archive(extra=tarfile.TarInfo('../../etc/other')))

    def test_wrong_content_denied(self):
        raw,files=self.archive();files['app/apps/cop-api/dist/server.js']='0'*64
        with self.assertRaises(AssertionError):self.check(raw,files)

    def test_real_expected_layer_digest_required(self):
        raw,_=self.archive()
        with self.assertRaises(AssertionError):r.validate_layer(raw)


if __name__=='__main__':unittest.main()
