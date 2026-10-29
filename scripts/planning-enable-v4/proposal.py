"""Fixed server-RAM flag proposal. No credential adapter or writer/authority."""
from pathlib import Path


class Proposal:
    __slots__ = ('_environment', '_compose')

    def __init__(self, environment, compose):
        self._environment, self._compose = environment, compose

    def __repr__(self):
        return '<COP one-flag proposal; payload redacted>'

    def consume_environment(self):
        if self._environment is None:
            raise ValueError('PROPOSAL_ALREADY_CONSUMED')
        result, self._environment = self._environment, None
        return result

    def compose_bytes(self):
        return dict(self._compose)


def propose(r, store, kernel, stage):
    kernel.need(store.source == Path('/srv/cop') and stage in kernel.STAGES, 'ENABLE_FIXED_PROPOSAL_SCOPE')
    modes = {'docker-compose.yml': 0o644, 'docker-compose.driver-measurements.yml': 0o664,
             'docker-compose.x5.yml': 0o600, 'docker-compose.ai-router.yml': 0o600}
    kernel.need(set(r.FILES) == set(modes), 'ENABLE_FIXED_COMPOSE_FILES')
    before = r.private_read(store.source / '.env', store.uid, limit=1048576)
    files = {name: r.private_read(store.source / name, store.uid, mode=modes[name], gid=1000) for name in modes}
    after = kernel.toggle_flag(before, stage)
    kernel.env_plan(before, after, stage, None)
    kernel.compose_plan(r, files, files, stage)
    return Proposal(after, files)
