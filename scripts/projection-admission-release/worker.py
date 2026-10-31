"""Ordinary guarded prepare/activate only; Root caller owns custody and locking.

No CLI, installer, Root GO, retry, journal deletion or pending recovery exists.
"""
from pathlib import Path


def prepare(r, kernel, store, proof_path, attestation_path, expected):
    path = Path(proof_path)
    raw = r.private_read(path, 0, mode=0o640, gid=1000)
    proof = kernel.parse(raw)
    kernel.need(path == r.PROFILES / kernel.PROFILE / ('account-erasure-' + proof['transitionId'] + '.json'),
                'ADMISSION_WORKER_PROOF_PATH')
    kernel.evidence(r, proof, True)
    kernel.need(expected == proof['previous']['generation'] and store.pointer() == proof['previous'],
                'ADMISSION_WORKER_CAS')
    target = kernel.target(proof['stage'])
    kernel.need(Path(attestation_path) == r.PROFILES / kernel.PROFILE / ('attestation-' + target['imageId'][7:] + '.json'),
                'ADMISSION_WORKER_ATTESTATION_PATH')
    return store.prepare(target['imageId'], target['sourceRevision'], Path(attestation_path), expected,
                         erasure_config=path)


def activate(r, kernel, store, release_id, expected):
    directory, binding, profile = store.binding(release_id)
    reference = binding['accountErasureConfig']
    _, proof = store.erasure_config_proof(Path(reference['path']), binding, reference['sha256'])
    kernel.need(proof['contractVersion'] == kernel.VERSION and binding['imageId'] == kernel.target(proof['stage'])['imageId']
                and expected == proof['previous']['generation'], 'ADMISSION_WORKER_RELEASE_SCOPE')
    kernel.evidence(r, proof, True)
    with kernel.health_scope(r, store, proof):
        return store.activate(release_id, expected)


def return_pending(r, store, proof_path, expected):
    """Dedicated guard method; generic recover(rollback) remains prohibited."""
    return store.revert_admission_pending(Path(proof_path), expected)
