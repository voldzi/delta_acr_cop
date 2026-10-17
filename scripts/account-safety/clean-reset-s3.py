"""Finite COP test-media reset. Fixed bucket; no CLI, provider fallback or backup.

The common Root owner supplies its continuously held stopped-writer admission
and already authenticated storage transport. Credentials remain in RAM and the
two existing production secret files. This does not start any COP/SIM writer.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import socket
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ENDPOINT = 'http://storage.home.cz:8333'
BUCKET = 'cop-community-media'
ENV = Path('/srv/cop/.env')
NS = '{http://s3.amazonaws.com/doc/2006-03-01/}'
PROCESS_ENV = {'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME':'/root', 'LANG':'C'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def credential_fingerprint(credential):
    return hashlib.sha256(b'cop-media-server-credential-v1\0'+json.dumps(
        [credential['accessKeyId'], credential['secretAccessKey']], separators=(',', ':')).encode()).hexdigest()


def xml(raw, name):
    need(isinstance(raw, bytes) and len(raw) <= 1048576 and b'<!' not in raw,
         'RESET_S3_XML_UNSAFE')
    value = ET.fromstring(raw)
    need(value.tag == NS + name, 'RESET_S3_XML_SCOPE')
    return value


def objects(raw):
    root = xml(raw, 'ListBucketResult')
    allowed = {'Name','Prefix','KeyCount','MaxKeys','Delimiter','IsTruncated','Contents',
               'NextContinuationToken','ContinuationToken','StartAfter'}
    need(all(child.tag in {NS+n for n in allowed} for child in root)
         and root.findtext(NS+'Prefix') in {None, ''} and root.findtext(NS+'Delimiter') in {None, ''},
         'RESET_S3_INVENTORY_SCOPE')
    need(len(root.findall(NS+'Name')) == len(root.findall(NS+'IsTruncated')) == 1
         and root.findtext(NS+'Name') == BUCKET and root.findtext(NS+'IsTruncated') in {'true', 'false'},
         'RESET_S3_INVENTORY_SCOPE')
    result = []
    for item in root.findall(NS+'Contents'):
        need(all(len(item.findall(NS+k)) == 1 for k in ['Key', 'Size', 'ETag']), 'RESET_S3_OBJECT_INVALID')
        key, size, etag = [item.findtext(NS+k) for k in ['Key', 'Size', 'ETag']]
        need(isinstance(key, str) and 0 < len(key.encode()) <= 1024 and '\0' not in key
             and not key.startswith('/') and '\\' not in key and not any(p in {'.','..'} for p in key.split('/'))
             and isinstance(size, str) and re.fullmatch(r'[0-9]{1,20}', size)
             and isinstance(etag, str) and 0 < len(etag) < 256, 'RESET_S3_OBJECT_INVALID')
        result.append({'key': key, 'bytes': int(size), 'etag': etag})
    need(len(root.findall(NS+'NextContinuationToken')) <= 1, 'RESET_S3_PAGINATION_UNPROVEN')
    next_token = root.findtext(NS+'NextContinuationToken')
    truncated = root.findtext(NS+'IsTruncated') == 'true'
    need(not truncated or isinstance(next_token, str) and 0 < len(next_token) <= 8192,
         'RESET_S3_PAGINATION_UNPROVEN')
    need(len({x['key'] for x in result}) == len(result), 'RESET_S3_DUPLICATE_OBJECT')
    count = root.findtext(NS+'KeyCount')
    need(count is None or count == str(len(result)), 'RESET_S3_INVENTORY_SCOPE')
    return result, next_token if truncated else None


def unversioned(raw):
    root = xml(raw, 'VersioningConfiguration')
    need(len(root) == 0 and not (root.text or '').strip(), 'RESET_S3_VERSIONING_UNSUPPORTED')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        raise RuntimeError('RESET_S3_REDIRECT_DENIED')


class S3:
    def __init__(self, credential):
        need(set(credential) == {'accessKeyId', 'secretAccessKey'} and
             all(isinstance(v, str) and 1 <= len(v) <= 256 and not any(c in v for c in '\r\n\0')
                 for v in credential.values()), 'RESET_S3_CREDENTIAL_INVALID')
        self.credential = credential
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method, key='', query=None):
        need(method in {'HEAD', 'GET', 'DELETE'}, 'RESET_S3_METHOD')
        query = query or {}
        path = '/' + BUCKET + (('/' + urllib.parse.quote(key, safe='/~')) if key else '')
        qs = '&'.join(urllib.parse.quote(k, safe='~')+'='+urllib.parse.quote(v, safe='~')
                      for k, v in sorted(query.items()))
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        date, host = stamp[:8], 'storage.home.cz:8333'
        payload = hashlib.sha256(b'').hexdigest()
        names = 'host;x-amz-content-sha256;x-amz-date'
        headers = 'host:'+host+'\nx-amz-content-sha256:'+payload+'\nx-amz-date:'+stamp+'\n'
        canonical = '\n'.join([method, path, qs, headers, names, payload])
        scope = date+'/us-east-1/s3/aws4_request'
        sign = lambda k, v: hmac.new(k, v.encode(), hashlib.sha256).digest()
        signing = sign(sign(sign(sign(('AWS4'+self.credential['secretAccessKey']).encode(), date),
                                'us-east-1'), 's3'), 'aws4_request')
        signature = hmac.new(signing, ('AWS4-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+
            hashlib.sha256(canonical.encode()).hexdigest()).encode(), hashlib.sha256).hexdigest()
        request = urllib.request.Request(ENDPOINT+path+('?' + qs if qs else ''), method=method,
            headers={'x-amz-date': stamp, 'x-amz-content-sha256': payload,
                     'authorization': 'AWS4-HMAC-SHA256 Credential='+self.credential['accessKeyId']+'/'+scope+
                     ', SignedHeaders='+names+', Signature='+signature})
        try:
            response = self.opener.open(request, timeout=8)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(1048577)
            need(len(raw) <= 1048576, 'RESET_S3_RESPONSE_LIMIT')
            return response.status, raw

    def inventory(self):
        status, raw = self.request('GET', query={'versioning': ''})
        need(status == 200, 'RESET_S3_VERSIONING_UNAVAILABLE')
        unversioned(raw)
        result, token, seen, pages = [], None, set(), 0
        while True:
            pages += 1
            need(pages <= 1000, 'RESET_S3_PAGINATION_LIMIT')
            query = {'list-type': '2', 'max-keys': '1000'}
            if token:
                query['continuation-token'] = token
            status, raw = self.request('GET', query=query)
            need(status == 200, 'RESET_S3_INVENTORY_UNAVAILABLE')
            page, token = objects(raw)
            result.extend(page)
            need(len(result) <= 100000 and len({x['key'] for x in result}) == len(result),
                 'RESET_S3_INVENTORY_LIMIT_OR_DUPLICATE')
            if not token:
                return sorted(result, key=lambda x: x['key'])
            need(token not in seen, 'RESET_S3_PAGINATION_REPEATED')
            seen.add(token)


def read_env():
    need(os.getuid() == 0 and ENV.parent.resolve() == ENV.parent, 'RESET_S3_ROOT_REQUIRED')
    fd = os.open(ENV, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid in {0, 1000}
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 1048576, 'RESET_S3_ENV_CUSTODY')
        raw = os.read(fd, 1048577)
        after = os.fstat(fd)
        need(len(raw) == info.st_size and (info.st_ino, info.st_mtime_ns, info.st_ctime_ns) ==
             (after.st_ino, after.st_mtime_ns, after.st_ctime_ns), 'RESET_S3_ENV_CHANGED')
    finally:
        os.close(fd)
    values = {}
    for line in raw.decode().splitlines():
        key, sep, value = line.partition('=')
        if sep and (key.startswith('COP_MEDIA_') or key == 'COP_ACCOUNT_ERASURE_ENABLED'):
            need(key not in values, 'RESET_S3_ENV_DUPLICATE')
            if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key] = value
    need(values.get('COP_MEDIA_S3_ENDPOINT') == ENDPOINT and values.get('COP_MEDIA_S3_BUCKET') == BUCKET
         and values.get('COP_ACCOUNT_ERASURE_ENABLED', 'false') == 'false', 'RESET_S3_ENV_SCOPE')
    credential = {'accessKeyId': values['COP_MEDIA_S3_ACCESS_KEY_ID'],
                  'secretAccessKey': values['COP_MEDIA_S3_SECRET_ACCESS_KEY']}
    S3(credential)
    return raw, info, credential


def replace_env(raw, info, credential, admission):
    updates = {'COP_MEDIA_S3_ACCESS_KEY_ID': credential['accessKeyId'],
               'COP_MEDIA_S3_SECRET_ACCESS_KEY': credential['secretAccessKey'], 'COP_MEDIA_UPLOAD_TRANSPORT': 'cop_api'}
    need(all(re.fullmatch(r'[A-Za-z0-9_-]{32,128}', v) for k, v in updates.items() if k != 'COP_MEDIA_UPLOAD_TRANSPORT'),
         'RESET_S3_NEW_CREDENTIAL_INVALID')
    out, seen = [], set()
    for line in raw.decode().splitlines(keepends=True):
        key = line.partition('=')[0]
        if key in updates:
            need(key not in seen, 'RESET_S3_ENV_DUPLICATE')
            seen.add(key)
            out.append(key+'='+updates[key]+'\n')
        else:
            out.append(line)
    if out and not out[-1].endswith('\n'):
        out.append('\n')
    out.extend(k+'='+v+'\n' for k, v in updates.items() if k not in seen)
    proposed = ''.join(out).encode()
    admission.assert_current()
    need(read_env()[0] == raw, 'RESET_S3_ENV_CHANGED')
    fd, name = tempfile.mkstemp(prefix='.cop-clean-media-', dir=ENV.parent)
    try:
        os.fchown(fd, info.st_uid, info.st_gid); os.fchmod(fd, stat.S_IMODE(info.st_mode))
        with os.fdopen(fd, 'wb') as stream:
            stream.write(proposed); stream.flush(); os.fsync(stream.fileno())
        admission.assert_current()
        need(read_env()[0] == raw, 'RESET_S3_ENV_CHANGED')
        os.replace(name, ENV); name = None
        directory = os.open(ENV.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(directory)
        finally: os.close(directory)
        need(read_env()[0] == proposed, 'RESET_S3_ENV_READBACK')
    finally:
        if name:
            os.unlink(name)


class ProductionStorage:
    """Fixed storage host/credential operation over an authenticated Root TTY.
    No new SSH key, agent forwarding, public port or application RPC is created.
    """
    directory = Path('/run/cop-clean-reset-storage')

    def __init__(self, plan):
        need(os.getuid() == 0 and socket.gethostname().split('.')[0] == 'docker', 'RESET_S3_ROOT_REQUIRED')
        relative = 'scripts/account-safety/install-media-upload-closure.mjs'
        source = plan['sources']['cop']
        path = Path(source['root'])/relative
        need(path.resolve() == path and relative in source['files'], 'RESET_S3_SOURCE_SCOPE')
        raw = path.read_bytes()
        need(hashlib.sha256(raw).hexdigest() == source['files'][relative], 'RESET_S3_SOURCE_CHANGED')
        # Reuse only the finite, reviewed storage process. Never invoke its old
        # release/whole11 installer or manufacture an old-scope release receipt.
        pattern = r'export const STORAGE_PROGRAM=String.raw`(.*?)`;\nconst TRANSPORT_DIRECTORY='
        found = re.findall(pattern, raw.decode(), re.S)
        need(len(found) == 1, 'RESET_S3_PROVIDER_SOURCE_MISSING')
        self.program = found[0]
        self.reviewed = None
        self.owner = None

    def args(self):
        return ['/usr/bin/ssh', '-F', '/dev/null', '-S', str(self.directory/'master.sock'),
                '-o', 'UserKnownHostsFile=/home/voldzi/.ssh/known_hosts', '-o', 'GlobalKnownHostsFile=/dev/null',
                '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ForwardAgent=no',
                '-o', 'ForwardX11=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=8']

    def custody(self):
        need(self.owner is not None, 'RESET_S3_TRANSPORT_CLOSED')
        d, s = self.directory.lstat(), (self.directory/'master.sock').lstat()
        need(stat.S_ISDIR(d.st_mode) and (d.st_dev, d.st_ino) == self.owner
             and d.st_uid == s.st_uid == 0 and stat.S_IMODE(d.st_mode) == 0o700
             and stat.S_ISSOCK(s.st_mode) and not stat.S_IMODE(s.st_mode) & 0o077,
             'RESET_S3_TRANSPORT_CUSTODY')

    def open(self, reviewed):
        need(not self.directory.exists() and re.fullmatch(r'[a-f0-9]{64}', reviewed['containerId'])
             and re.fullmatch(r'sha256:[a-f0-9]{64}', reviewed['providerImageId']), 'RESET_S3_TRANSPORT_PLAN')
        self.reviewed = reviewed
        self.directory.mkdir(mode=0o700)
        s = self.directory.lstat(); self.owner = (s.st_dev, s.st_ino)
        try:
            args = self.args()+['-M', '-o', 'ControlPersist=15m', '-o', 'BatchMode=no',
                '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password',
                '-o', 'KbdInteractiveAuthentication=no', '-o', 'NumberOfPasswordPrompts=1',
                'voldzi@storage.home.cz', '/usr/bin/sudo', '-n', '/usr/bin/id', '-u']
            with open('/dev/tty', 'r+b', buffering=0) as tty:
                result = subprocess.run(args, stdin=tty, stdout=subprocess.PIPE, stderr=tty,
                    env=PROCESS_ENV, timeout=120, check=False)
            need(result.returncode == 0 and result.stdout == b'0\n', 'RESET_S3_STORAGE_AUTH_REQUIRED')
            self.custody()
            return self
        except BaseException:
            self.close(); raise

    def request(self, phase, current=None, **private):
        self.custody()
        payload = {'phase':phase, 'containerId':self.reviewed['containerId'],
                   'providerImageId':self.reviewed['providerImageId'], **private}
        if current is not None:
            payload.update(spec=current['spec'], configDigest=current['configDigest'])
        command = shlex.join(['/usr/bin/sudo', '-n', '/usr/bin/env', '-u', 'PYTHONPATH', '-u', 'PYTHONHOME',
                              '/usr/bin/python3', '-I', '-c', self.program])
        result = subprocess.run(self.args()+['-o', 'BatchMode=yes', '-o', 'ControlMaster=no',
            '-o', 'ProxyCommand=/usr/bin/false', 'voldzi@storage.home.cz', command],
            input=json.dumps(payload).encode(), capture_output=True, env=PROCESS_ENV, timeout=120, check=False)
        self.custody()
        need(result.returncode == 0 and len(result.stdout) <= 4*1048576, 'RESET_S3_STORAGE_PHASE_FAILED')
        return json.loads(result.stdout)

    def inspect(self): return self.request('inspect')
    def stop(self, current): return self.request('stop', current)
    def rotate(self, current, old, new): return self.request('rotate', current, oldCredential=old, newCredential=new)
    def start(self, current): return self.request('start', current)

    def close(self):
        if self.owner is None: return
        try:
            self.custody()
            subprocess.run(self.args()+['-O', 'exit', 'voldzi@storage.home.cz'], stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=PROCESS_ENV, timeout=10, check=False)
            (self.directory/'master.sock').unlink(missing_ok=True)
            self.directory.rmdir()
        except FileNotFoundError:
            d = self.directory.lstat()
            if (d.st_dev, d.st_ino) == self.owner and d.st_uid == 0 and not list(self.directory.iterdir()):
                self.directory.rmdir()
        finally:
            self.owner = None


def inspect_s3_reset(storage):
    _, _, credential = read_env()
    current = storage.inspect()
    selected = [x for x in current['configuration']['identities'] if x.get('name') == 'cop-production']
    need(len(selected) == 1 and selected[0].get('credentials') ==
         [{'accessKey':credential['accessKeyId'], 'secretKey':credential['secretAccessKey']}],
         'RESET_S3_PROVIDER_CREDENTIAL_MISMATCH')
    rows = S3(credential).inventory()
    return {'contractVersion':'cop-clean-s3-reset-plan-v1', 'bucket':BUCKET,
            'containerId':current['spec']['Id'], 'providerImageId':current['spec']['Image'],
            'configDigest':current['configDigest'], 'inventoryDigest':digest(rows),
            'credentialFingerprint':digest(credential), 'objectCount':len(rows)}


def apply_s3_reset(reviewed, admission, storage):
    """storage is the sealed finite provider transport, not an app callback.
    The caller preflights this exact plan before stopping any application.
    """
    admission.assert_current()
    raw, info, old = read_env()
    current = storage.inspect()
    rows = S3(old).inventory()
    before = {'contractVersion': 'cop-clean-s3-reset-plan-v1', 'bucket': BUCKET,
              'containerId': current['spec']['Id'], 'providerImageId': current['spec']['Image'],
              'configDigest': current['configDigest'], 'inventoryDigest': digest(rows),
              'credentialFingerprint': digest(old), 'objectCount': len(rows)}
    need(before == reviewed, 'RESET_S3_PLAN_DRIFT')
    new = {'accessKeyId': secrets.token_urlsafe(32), 'secretAccessKey': secrets.token_urlsafe(48)}
    admission.assert_current()
    stopped = storage.stop(current)
    need(stopped.get('pid') == 0 and stopped.get('sameSpec') is True, 'RESET_S3_PROVIDER_NOT_STOPPED')
    # A stopped server terminates legacy admitted upload bodies. Rotation makes
    # every former presigned URL invalid; no old credential is restored on error.
    admission.assert_current()
    replace_env(raw, info, new, admission)
    rotated = storage.rotate(current, old, new)
    admission.assert_current()
    started = storage.start({**current, 'configDigest': rotated['configDigest']})
    need(started.get('sameSpec') is True and started.get('imageId') == before['providerImageId'],
         'RESET_S3_PROVIDER_CHANGED')
    client = S3(new)
    deadline = time.monotonic()+15
    while True:
        admission.assert_current()
        try:
            if client.request('HEAD')[0] == 200:
                break
        except urllib.error.URLError:
            pass
        need(time.monotonic() < deadline, 'RESET_S3_PROVIDER_NOT_READY')
        time.sleep(0.25)
    need(S3(old).request('HEAD')[0] == 403, 'RESET_S3_OLD_CREDENTIAL_ACCEPTED')
    denied_at = datetime.now(timezone.utc).isoformat()
    need(client.inventory() == rows, 'RESET_S3_INVENTORY_CHANGED')
    for item in rows:
        admission.assert_current()
        need(client.request('DELETE', item['key'])[0] in {200, 204}, 'RESET_S3_DELETE_FAILED')
        need(client.request('HEAD', item['key'])[0] == 404, 'RESET_S3_OBJECT_REMAINING')
    need(client.inventory() == [], 'RESET_S3_BUCKET_NOT_EMPTY')
    admission.assert_current()
    evidence = {'contractVersion':'cop-clean-s3-closure-evidence-v1', 'bucket':BUCKET, 'endpoint':ENDPOINT,
                'providerImageId':before['providerImageId'], 'providerStoppedAt':stopped['stoppedAt'],
                'providerRestartedAt':started['startedAt'], 'oldCredentialDeniedAt':denied_at,
                'credentialFingerprint':credential_fingerprint(new),
                'previousCredentialFingerprint':credential_fingerprint(old),
                'legacyAdmittedBodiesTerminated':True, 'oldCredentialDenied':True,
                'remainingObjects':0, 'removedObjects':len(rows)}
    return {'contractVersion': 'cop-clean-s3-reset-result-v1', 'removedObjects': len(rows),
            'remainingObjects': 0, 'oldCredentialDenied': True, 'providerImagePreserved': True,
            'oldDataBackupCreated': False, 'wholeAccountComplete': False,
            'evidence':evidence, 'evidenceDigest':digest(evidence)}
