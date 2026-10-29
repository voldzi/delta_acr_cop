"""Pure exact extension of 7ad48; creates bytes, never installs a guard."""
import hashlib

BASE = '7ad48b1ba4f83ec78b287e14308a78e663a62408d8e2b3b40a8513cbd36e098f'


def construct(raw, kernel):
    if hashlib.sha256(raw).hexdigest() != BASE:
        raise ValueError('ENABLE_EXACT_BASE_REQUIRED')
    compile(kernel, '<fresh-flag-kernel>', 'exec')
    text = raw.decode()
    old = "PLANNING_CONFIG_V3_KERNEL_SHA256 = '78efa038f2f49893502c9d62d2724881c744d124d95aec915a7a0a0bb37f5acd'"
    if text.count(old) != 1:
        raise ValueError('ENABLE_KERNEL_ANCHOR')
    text = text.replace(old, "PLANNING_CONFIG_V3_KERNEL_SHA256 = '" + hashlib.sha256(kernel).hexdigest() + "'\nPLANNING_ENABLE_V4_VERSION = 'cop-planning-enable-v4'")
    old = 'PLANNING_CONFIG_V3_VERSION}\n\n\ndef node_metadata_transition'
    if text.count(old) != 1:
        raise ValueError('ENABLE_VERSION_ANCHOR')
    text = text.replace(old, 'PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}\n\n\ndef node_metadata_transition')
    old = "== PLANNING_CONFIG_V3_VERSION:"
    if text.count(old) != 7:
        raise ValueError('ENABLE_DISPATCH_ANCHORS')
    text = text.replace(old, "in {PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION}:")
    compile(text, '<fresh-flag-guard>', 'exec')
    return text.encode()
