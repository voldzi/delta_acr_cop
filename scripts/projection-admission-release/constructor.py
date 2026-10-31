"""Pure exact A56a extension. Produces bytes, never installs or executes them."""
import hashlib

BASE = 'a56a57532e6ce4a6a8dc15ba608fbbe63f1f10fe4d80c3540bd08e4c67bb7390'
VERSION = 'cop-projection-admission-image-v1'


def construct(raw, kernel):
    if hashlib.sha256(raw).hexdigest() != BASE:
        raise ValueError('ADMISSION_EXACT_PARENT_REQUIRED')
    compile(kernel, '<admission-image-kernel>', 'exec')
    text = raw.decode()
    def change(old, new, count=1):
        nonlocal text
        if text.count(old) != count:
            raise ValueError('ADMISSION_EXACT_ANCHOR')
        text = text.replace(old, new)
    change("PLANNING_CONFIG_V3_KERNEL_SHA256 = 'f847d23d9200fa80b98bbefef6214c4a0048c041a43dbe8b83faded1ae33142d'",
           "PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + hashlib.sha256(kernel).hexdigest() + "'\nADMISSION_IMAGE_VERSION = '" + VERSION + "'")
    change('in {PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}:',
           'in {PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION}:', 7)
    change('PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}\n\n\ndef node_metadata_transition',
           'PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION}\n\n\ndef node_metadata_transition')
    change('        if image == PLANNING_BOOTSTRAP_V3_IMAGE:',
           "        if image == 'sha256:51a10099616c4b2bbd2607391413de975fdf49ba0b2df403db6d3e9785eb9094':\n"
           '            store=Store(uid=1000)\n'
           '            store.planning_config_v3_module().image(store.post_edge_runtime(),self,inspected,revision)\n'
           '        elif image == PLANNING_BOOTSTRAP_V3_IMAGE:')
    compile(text, '<admission-image-guard>', 'exec')
    return text.encode()
