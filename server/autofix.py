"""Automatic bug-fixing: when a game throws a client-side error, or the
server hits an unhandled exception, ask Claude to patch the offending
file and push the fix — fully automatic, no human review step.

Safety nets, since this pushes straight to main with nothing in between:
- Python fixes are syntax-checked (compile()) before being written or
  committed. A fix that doesn't even parse is discarded, not pushed.
- Game fixes are sanity-checked to still look like an HTML document.
- A per-(file, error) cooldown stops the same recurring bug from
  triggering a fix attempt (and an Anthropic API call, and a commit)
  more than once every few minutes — otherwise a bug that fires on
  every request could spin in a loop.
- Every fix is its own git commit, so a bad auto-fix is a single
  `git revert` away from being undone.
"""

import hashlib
import os
import time

import gamegen

ROOT_DIR = gamegen.ROOT_DIR
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))

COOLDOWN_SECONDS = 600  # don't re-attempt the same (file, error) within 10 min
_last_attempt = {}  # cooldown_key -> unix timestamp


FIX_SYSTEM_PROMPT = """You are an automatic bug-fixing agent for a live web app. \
You will be given a file's current full contents and an error that occurred. \
Output ONLY the complete corrected file contents — no markdown code fences, no \
commentary, nothing except the fixed file starting from its first character. \
Make the smallest change that fixes the bug; do not refactor or rewrite unrelated \
parts of the file."""


def _cooldown_key(scope, identifier, error_text):
    digest = hashlib.sha256(error_text.encode('utf-8', 'replace')).hexdigest()[:12]
    return f'{scope}:{identifier}:{digest}'


def _should_attempt(key):
    now = time.time()
    last = _last_attempt.get(key, 0)
    if now - last < COOLDOWN_SECONDS:
        return False
    _last_attempt[key] = now
    return True


def _ask_for_fix(file_label, original_content, error_context):
    prompt = (
        f'File: {file_label}\n\n'
        f'--- current file contents ---\n{original_content}\n--- end file ---\n\n'
        f'Error that occurred:\n{error_context}\n\n'
        'Fix the bug and return the complete corrected file.'
    )
    return gamegen.call_claude(FIX_SYSTEM_PROMPT, prompt, max_tokens=8000)


def fix_game_file(slug, error_message, stack=''):
    """Attempt to auto-fix a reported client-side error in games/<slug>.html."""
    key = _cooldown_key('game', slug, error_message)
    if not _should_attempt(key):
        return {'ok': False, 'skipped': True, 'reason': 'cooldown'}

    path = os.path.join(gamegen.GAMES_DIR, f'{slug}.html')
    if not os.path.exists(path):
        return {'ok': False, 'skipped': True, 'reason': 'game file not found'}

    with open(path, encoding='utf-8') as f:
        original = f.read()

    error_context = f'JavaScript error: {error_message}'
    if stack:
        error_context += f'\nStack trace:\n{stack}'

    try:
        fixed = _ask_for_fix(f'games/{slug}.html', original, error_context)
    except Exception as e:
        return {'ok': False, 'message': f'AI fix request failed: {e}'}

    if '<!doctype html' not in fixed[:200].lower():
        return {'ok': False, 'message': 'AI response did not look like a valid HTML document; discarded.'}

    with open(path, 'w', encoding='utf-8') as f:
        f.write(fixed)

    try:
        result = gamegen.commit_and_push_files(
            [f'games/{slug}.html'],
            f'Auto-fix bug in {slug}: {error_message[:80]}',
        )
    except Exception as e:
        return {'ok': False, 'message': f'Fix generated but push failed: {e}'}

    return {'ok': True, **result}


def fix_server_file(abs_path, error_summary, traceback_text=''):
    """Attempt to auto-fix a Python file that raised an unhandled exception."""
    abs_path = os.path.abspath(abs_path)
    if not abs_path.startswith(SERVER_DIR) or not abs_path.endswith('.py'):
        return {'ok': False, 'skipped': True, 'reason': 'refusing to auto-fix outside server/ or non-.py file'}

    rel_path = os.path.relpath(abs_path, ROOT_DIR)
    key = _cooldown_key('server', rel_path, error_summary)
    if not _should_attempt(key):
        return {'ok': False, 'skipped': True, 'reason': 'cooldown'}

    if not os.path.exists(abs_path):
        return {'ok': False, 'skipped': True, 'reason': 'file not found'}

    with open(abs_path, encoding='utf-8') as f:
        original = f.read()

    error_context = f'Unhandled exception: {error_summary}'
    if traceback_text:
        error_context += f'\nTraceback:\n{traceback_text}'

    try:
        fixed = _ask_for_fix(rel_path, original, error_context)
    except Exception as e:
        return {'ok': False, 'message': f'AI fix request failed: {e}'}

    try:
        compile(fixed, rel_path, 'exec')
    except SyntaxError as e:
        return {'ok': False, 'message': f'AI fix did not compile ({e}); discarded, not pushed.'}

    with open(abs_path, 'w', encoding='utf-8') as f:
        f.write(fixed)

    try:
        result = gamegen.commit_and_push_files(
            [rel_path],
            f'Auto-fix bug in {rel_path}: {error_summary[:80]}',
        )
    except Exception as e:
        return {'ok': False, 'message': f'Fix generated but push failed: {e}'}

    return {'ok': True, **result}
