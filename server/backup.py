"""Keeps accounts and NexBucks alive on Render's free tier.

Render's free plan has no persistent disk, so playnexus.db is wiped on every
redeploy and idle restart. This module snapshots the database, encrypts it
with a key derived from SECRET_KEY, and stores it on a separate `data`
branch of the GitHub repo (Render only deploys main, so it never triggers a
redeploy). On startup, if the local DB is missing or empty, the latest
snapshot is restored before the app serves anything.

Needs GITHUB_TOKEN (already used by auto-fix). Without it, this is a no-op.
"""

import base64
import hashlib
import hmac
import os
import sqlite3
import threading
import time

import requests

BRANCH = 'data'
PATH = 'playnexus.db.enc'
INTERVAL = 30  # seconds between change checks

_enabled = {'ok': False}


def _repo():
    return (os.environ.get('GITHUB_REPO') or 'austinhocking1-hash/Play-Nexus').strip()


def _headers(extra=None):
    h = {'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'].strip(),
         'Accept': 'application/vnd.github+json', 'User-Agent': 'playnexus-backup'}
    h.update(extra or {})
    return h


def _key():
    return hashlib.sha256(b'playnexus-backup|' + os.environ['SECRET_KEY'].encode()).digest()


def _stream(key, nonce, n):
    out, i = b'', 0
    while len(out) < n:
        out += hmac.new(key, nonce + i.to_bytes(8, 'big'), hashlib.sha256).digest()
        i += 1
    return out[:n]


def encrypt(data):
    key, nonce = _key(), os.urandom(16)
    body = bytes(a ^ b for a, b in zip(data, _stream(key, nonce, len(data))))
    tag = hmac.new(key, nonce + body, hashlib.sha256).digest()
    return b'PNB1' + nonce + tag + body


def decrypt(blob):
    key = _key()
    if blob[:4] != b'PNB1':
        raise ValueError('bad backup header')
    nonce, tag, body = blob[4:20], blob[20:52], blob[52:]
    if not hmac.compare_digest(tag, hmac.new(key, nonce + body, hashlib.sha256).digest()):
        raise ValueError('backup failed authentication (SECRET_KEY changed?)')
    return bytes(a ^ b for a, b in zip(body, _stream(key, nonce, len(body))))


def _snapshot(db_path):
    """Consistent copy of the live DB as bytes."""
    tmp = db_path + '.snap'
    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    with open(tmp, 'rb') as f:
        data = f.read()
    os.remove(tmp)
    return data


def _has_users(db_path):
    if not os.path.exists(db_path):
        return False
    try:
        c = sqlite3.connect(db_path)
        n = c.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        c.close()
        return n > 0
    except sqlite3.Error:
        return False


def _remote_get():
    """Returns (sha, bytes) or (None, None) if no backup exists yet."""
    url = f'https://api.github.com/repos/{_repo()}/contents/{PATH}'
    meta = requests.get(url, params={'ref': BRANCH}, headers=_headers(), timeout=30)
    if meta.status_code == 404:
        return None, None
    meta.raise_for_status()
    sha = meta.json()['sha']
    raw = requests.get(url, params={'ref': BRANCH},
                       headers=_headers({'Accept': 'application/vnd.github.raw'}), timeout=60)
    raw.raise_for_status()
    return sha, raw.content


def _ensure_branch():
    r = requests.get(f'https://api.github.com/repos/{_repo()}/git/ref/heads/{BRANCH}',
                     headers=_headers(), timeout=30)
    if r.status_code == 200:
        return
    base = requests.get(f'https://api.github.com/repos/{_repo()}/git/ref/heads/main',
                        headers=_headers(), timeout=30)
    base.raise_for_status()
    requests.post(f'https://api.github.com/repos/{_repo()}/git/refs', headers=_headers(),
                  json={'ref': 'refs/heads/' + BRANCH, 'sha': base.json()['object']['sha']},
                  timeout=30).raise_for_status()


def _remote_put(blob, sha):
    _ensure_branch()
    body = {'message': 'DB backup', 'branch': BRANCH,
            'content': base64.b64encode(blob).decode()}
    if sha:
        body['sha'] = sha
    r = requests.put(f'https://api.github.com/repos/{_repo()}/contents/{PATH}',
                     headers=_headers(), json=body, timeout=60)
    r.raise_for_status()
    return r.json()['content']['sha']


def restore_if_needed(db_path):
    """Call before init_db. Pulls the latest snapshot when the local DB is empty."""
    if not (os.environ.get('GITHUB_TOKEN') and os.environ.get('SECRET_KEY')):
        print('[playnexus] backup disabled (GITHUB_TOKEN not set)')
        return
    try:
        if _has_users(db_path):
            _enabled['ok'] = True
            return
        sha, blob = _remote_get()
        if blob:
            with open(db_path, 'wb') as f:
                f.write(decrypt(blob))
            print('[playnexus] restored database from GitHub backup')
        else:
            print('[playnexus] no backup yet; starting fresh')
        _enabled['ok'] = True
    except Exception as e:  # never block startup; also never overwrite a backup we couldn't read
        print('[playnexus] backup restore FAILED, backups paused:', e)


def _loop(db_path):
    last_hash, sha = None, None
    while True:
        time.sleep(INTERVAL)
        try:
            data = _snapshot(db_path)
            h = hashlib.sha256(data).hexdigest()
            if h == last_hash:
                continue
            if sha is None:
                sha, _ = _remote_get()
            sha = _remote_put(encrypt(data), sha)
            last_hash = h
        except Exception as e:
            sha = None
            print('[playnexus] backup failed:', e)


def start(db_path):
    if not _enabled['ok']:
        return
    threading.Thread(target=_loop, args=(db_path,), daemon=True).start()
