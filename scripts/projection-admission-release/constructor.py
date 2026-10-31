"""Pure exact A56a extension. Produces bytes, never installs or executes them."""
import hashlib

BASE = 'a56a57532e6ce4a6a8dc15ba608fbbe63f1f10fe4d80c3540bd08e4c67bb7390'
VERSION = 'cop-projection-admission-image-v1'


def construct(raw, kernel, pending_worker):
    if hashlib.sha256(raw).hexdigest() != BASE:
        raise ValueError('ADMISSION_EXACT_PARENT_REQUIRED')
    compile(kernel, '<admission-image-kernel>', 'exec')
    compile(pending_worker, '<admission-pending-worker>', 'exec')
    text = raw.decode()
    def change(old, new, count=1):
        nonlocal text
        if text.count(old) != count:
            raise ValueError('ADMISSION_EXACT_ANCHOR')
        text = text.replace(old, new)
    change("PLANNING_CONFIG_V3_KERNEL_SHA256 = 'f847d23d9200fa80b98bbefef6214c4a0048c041a43dbe8b83faded1ae33142d'",
           "PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + hashlib.sha256(kernel).hexdigest() + "'\nADMISSION_IMAGE_VERSION = '" + VERSION + "'\nADMISSION_PENDING_RETURN_SHA256 = '" + hashlib.sha256(pending_worker).hexdigest() + "'")
    change('in {PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}:',
           'in {PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION}:', 7)
    change('PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}\n\n\ndef node_metadata_transition',
           'PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION}\n\n\ndef node_metadata_transition')
    change('        if image == PLANNING_BOOTSTRAP_V3_IMAGE:',
           "        if image == 'sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094':\n"
           '            store=Store(uid=1000)\n'
           '            store.planning_config_v3_module().image(store.post_edge_runtime(),self,inspected,revision)\n'
           '        elif image == PLANNING_BOOTSTRAP_V3_IMAGE:')
    change("    def revert_arrival(self, proof, attestation, expected):", '''    def revert_admission_pending(self, proof, expected):
        path = self.protected_root / '206c4507-5e00-458e-b0ee-4061309aa7a8' / ('admission-pending-return-worker-' + ADMISSION_PENDING_RETURN_SHA256 + '.py')
        self.protected_directory(path.parent)
        raw = private_read(path, 0, mode=0o640, gid=1000)
        require(sha(raw) == ADMISSION_PENDING_RETURN_SHA256, 'admission_pending_worker_changed')
        import types
        worker = types.ModuleType('closed_admission_pending_return')
        exec(compile(raw, str(path), 'exec'), worker.__dict__)
        return worker.execute(self.post_edge_runtime(), self.planning_config_v3_module(), self, proof, expected)

    def revert_arrival(self, proof, attestation, expected):''')
    change("    def clean(self):\n", "    def clean(self):\n        require(not os.path.lexists(self.root / 'admission-pending-return.json'), 'admission_return_pending')\n")
    compile(text, '<admission-image-guard>', 'exec')
    return text.encode()
