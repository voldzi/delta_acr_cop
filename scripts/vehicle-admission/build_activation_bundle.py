"""Prepare public, hashed Root-install inputs. Never installs or contacts a host."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import uuid

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location('admission_build_' + name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def build(destination, parent_guard, parent_policy):
    installer, constructor = load('install_activation'), load('constructor')
    destination.mkdir(mode=0o700)
    files = {name + '.py': (HERE / (name + '.py')).read_bytes() for name in installer.NAMES}
    guard = constructor.construct(parent_guard.read_bytes(), files['kernel.py'])
    policy = constructor.repin_policy(parent_policy.read_bytes(), guard)
    nonce = str(uuid.uuid4())
    value = {'contractVersion': 'cop-vehicle-admission-root-payload-v1',
        'windowId': nonce, 'scope': 'global_authorized_vehicle_members',
        'admissionLifetime': 'until_explicit_disable',
        'baselineCop': {'containerId': installer.COP_CID, 'contractVersion': 'cop-api-runtime-active-v1',
            'generation': installer.GENERATION,
            'imageId': 'sha256:1338179f0f66abf904aad04da82fc87f82f9676d758842bd00eec4b9e0662d7d',
            'profileGeneration': '206c4507-5e00-458e-b0ee-4061309aa7a8',
            'profileId': '206c4507-5e00-458e-b0ee-4061309aa7a8',
            'releaseId': 'release-4daef7fb69ea4e40a8d2dbb560255dbf'},
        'baselineMessagingCanonicalDigest': '9050389823b52eff5c8aae2a31a23dd7c9b1d940dcd76d7f01b3399728e3bf41',
        'expectedGuardSha256': hashlib.sha256(guard).hexdigest(),
        'expectedPolicySha256': hashlib.sha256(policy).hexdigest(),
        'assets': {name: base64.b64encode(raw).decode() for name, raw in sorted(files.items())}}
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    payload = destination / 'payload.json'
    payload.write_bytes(raw)
    payload.chmod(0o600)
    for name in ('install_activation.py', 'activation.py'):
        (destination / name).write_bytes(files[name])
        (destination / name).chmod(0o600)
    review = {'scope': value['scope'], 'admissionLifetime': value['admissionLifetime'],
        'windowId': nonce, 'payloadSha256': hashlib.sha256(raw).hexdigest(),
        'installerSha256': hashlib.sha256(files['install_activation.py']).hexdigest(),
        'guardSha256': value['expectedGuardSha256'], 'policySha256': value['expectedPolicySha256'],
        'kernelSha256': hashlib.sha256(files['kernel.py']).hexdigest(),
        'sourceAssets': {name: hashlib.sha256(body).hexdigest() for name, body in sorted(files.items())},
        'installerDoesNotEnableAdmission': True, 'authorityEntrySeconds': 3600,
        'ordinaryBrokerCanChangeConfiguration': False, 'otherImagesNeverRestored': True,
        'disableOnlySupportsThisExactImageLineage': True, 'runtimeAcceptance': False,
        'installed': False, 'productionChanged': False}
    (destination / 'review.json').write_text(json.dumps(review, indent=2) + '\n')
    return review


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--destination', required=True, type=Path)
    p.add_argument('--parent-guard', required=True, type=Path)
    p.add_argument('--parent-policy', required=True, type=Path)
    args = p.parse_args()
    print(json.dumps(build(args.destination, args.parent_guard, args.parent_policy)))
