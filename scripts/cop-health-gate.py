#!/usr/bin/env python3
"""Bounded public health checks; retain statuses only, never raw responses."""
import argparse
import json
import re
import time
import urllib.error
import urllib.request

URLS = ('http://127.0.0.1:4310/health/live', 'http://127.0.0.1:4310/health/ready',
        'http://127.0.0.1:4310/health/dependencies',
        'https://cop.zeleznalady.cz/demo/flood-central-bohemia')
STATES = {'ok', 'online', 'degraded', 'unavailable', 'offline', 'disabled', 'skipped'}
RANK = {'ok': 0, 'online': 0, 'degraded': 1, 'unavailable': 2, 'offline': 2}


def status_metadata(raw):
    """Only contract status enums and public dependency names are retained."""
    try:
        value = json.loads(raw)
        status = value.get('status')
        if status not in STATES:
            return {'status': 'unknown'}
        result = {'status': status}
        if 'dependencies' in value:
            dependencies = {}
            for item in value['dependencies']:
                name, state = item.get('name'), item.get('status')
                if (not isinstance(name, str) or not re.fullmatch(r'[a-z0-9_-]{1,80}', name)
                        or state not in STATES or name in dependencies):
                    return {'status': 'unknown'}
                dependencies[name] = state
            result['dependencies'] = dependencies
        return result
    except (ValueError, TypeError, AttributeError):
        return {'status': 'unknown'}


def capture(deadline=None):
    result = {}
    for url in URLS:
        remaining = deadline - time.monotonic() if deadline is not None else 20
        if remaining <= 0:
            result[url] = {'httpStatus': 0, 'status': 'unknown'}
            continue
        request = urllib.request.Request(url, headers={'DNT': '1', 'Sec-GPC': '1'})
        try:
            response = urllib.request.urlopen(request, timeout=min(12, remaining))
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, OSError, TimeoutError):
            result[url] = {'httpStatus': 0, 'status': 'unknown'}
            continue
        with response:
            item = {'httpStatus': response.status}
            if url != URLS[-1]:
                raw = response.read(65537)
                item.update(status_metadata(raw) if len(raw) <= 65536 else {'status': 'unknown'})
            result[url] = item
    return result


def no_regression(before, after):
    if set(before) != set(URLS) or set(after) != set(URLS):
        return False
    for url in URLS:
        old, new = before[url], after[url]
        if new['httpStatus'] != old['httpStatus']:
            if not (old['httpStatus'] == 503 and new['httpStatus'] == 200):
                return False
        if url == URLS[-1]:
            continue
        old_states = {'self': old.get('status'), **old.get('dependencies', {})}
        new_states = {'self': new.get('status'), **new.get('dependencies', {})}
        if old_states.keys() != new_states.keys():
            return False
        for name, previous in old_states.items():
            current = new_states[name]
            if 'unknown' in (previous, current):
                return False
            if current != previous and not (
                    previous in RANK and current in RANK and RANK[current] <= RANK[previous]):
                return False
    return after[URLS[0]]['httpStatus'] == 200 and after[URLS[-1]]['httpStatus'] == 200


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('capture')
    verify = commands.add_parser('verify')
    verify.add_argument('baseline')
    args = parser.parse_args()
    if args.action == 'capture':
        value = capture(time.monotonic() + 45)
        if (value[URLS[0]]['httpStatus'] != 200 or value[URLS[-1]]['httpStatus'] != 200
                or any(value[url].get('status') == 'unknown' for url in URLS[:-1])):
            raise SystemExit('Existing COP health is not acceptable or its status is unknown')
        print(json.dumps(value, sort_keys=True))
        return
    try:
        with open(args.baseline) as handle:
            before = json.load(handle)
    except (OSError, ValueError):
        raise SystemExit('COP baseline health metadata is invalid') from None
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        after = capture(deadline)
        if no_regression(before, after):
            print(json.dumps({'healthAndPublicDemoPreserved': True, 'statuses': after}, sort_keys=True))
            return
        time.sleep(min(1, max(0, deadline - time.monotonic())))
    raise SystemExit('COP health changed; follow the documented scoped rollback')


if __name__ == '__main__':
    main()
