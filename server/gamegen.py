"""AI game generation + auto-publish.

When an admin adds a game, this calls the Anthropic API to generate a
self-contained playable HTML file, writes it to games/<slug>.html, and
commits + pushes it to GitHub so the live deploy picks it up on its next
build. Requires ANTHROPIC_API_KEY and GITHUB_TOKEN to be set in the
environment — if they're missing, callers get a clear error instead of a
crash, and the game record itself is still created either way.
"""

import os
import re
import subprocess

import requests

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMES_DIR = os.path.join(ROOT_DIR, 'games')

ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
MODEL = 'claude-sonnet-5'

SYSTEM_PROMPT = """You write small, complete, self-contained browser games as a \
single HTML file for a game site called Play Nexus. Output ONLY the raw HTML \
document — no markdown code fences, no commentary before or after, nothing but \
the file content starting with <!DOCTYPE html>."""

PROMPT_TEMPLATE = """Generate a complete, playable, self-contained HTML5 browser game.

Title: {title}
Genre: {genre}

Requirements:
- A single HTML file: inline <style> and <script>, no external dependencies,
  no build step, no images from the internet — everything drawn with CSS/SVG/canvas.
- It must be genuinely playable with keyboard and/or mouse/touch input, with a
  clear win/lose or score condition, matching the "{genre}" genre.
- Visual style: dark background (#0a0b16 / #171933 tones), a gradient accent
  between #2fd0ff and #c026ff, matching a modern dark gaming aesthetic.
- Include a "&larr; Back to Play Nexus" link at the top pointing to "../index.html".
- Include a start screen with a "Start" button, and a game-over screen showing
  the score with a "Try Again" button, similar to a typical arcade game.
- Keep it well-contained in one file under roughly 300 lines.
- Output ONLY the raw HTML, nothing else.
"""


def slugify(text):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug or 'game'


def strip_code_fences(text):
    text = text.strip()
    text = re.sub(r'^```(?:html)?\s*\n', '', text)
    text = re.sub(r'\n```\s*$', '', text)
    return text.strip()


def generate_game_html(title, genre):
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError('ANTHROPIC_API_KEY is not set on the server.')
    api_key = api_key.strip()
    try:
        api_key.encode('ascii')
    except UnicodeEncodeError:
        raise RuntimeError(
            'ANTHROPIC_API_KEY contains a non-ASCII character (likely a '
            'copy-paste artifact like a smart quote or hidden formatting '
            'character). Re-copy the key directly from the Anthropic '
            'console using its copy button and re-paste it into the '
            'Render environment variable.'
        )

    prompt = PROMPT_TEMPLATE.format(title=title, genre=genre or 'Arcade')
    resp = requests.post(
        ANTHROPIC_API_URL,
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': MODEL,
            'max_tokens': 8000,
            'system': SYSTEM_PROMPT,
            'messages': [{'role': 'user', 'content': prompt}],
        },
        timeout=120,
    )
    if not resp.ok:
        raise RuntimeError(f'Anthropic API error ({resp.status_code}): {resp.text[:300]}')

    data = resp.json()
    parts = data.get('content', [])
    text = ''.join(p.get('text', '') for p in parts if p.get('type') == 'text')
    if not text.strip():
        raise RuntimeError('Anthropic API returned an empty response.')

    return strip_code_fences(text)


def write_game_file(slug, html):
    os.makedirs(GAMES_DIR, exist_ok=True)
    path = os.path.join(GAMES_DIR, f'{slug}.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return path


def _sanitize(text, token):
    if token and text:
        return text.replace(token, '***')
    return text


def commit_and_push(slug, title):
    token = os.environ.get('GITHUB_TOKEN')
    repo = os.environ.get('GITHUB_REPO', 'austinhocking1-hash/Play-Nexus')
    if not token:
        raise RuntimeError('GITHUB_TOKEN is not set on the server.')

    if not os.path.isdir(os.path.join(ROOT_DIR, '.git')):
        raise RuntimeError('No .git directory found — cannot commit/push from this deployment.')

    rel_path = f'games/{slug}.html'

    def run(args):
        return subprocess.run(
            args, cwd=ROOT_DIR, capture_output=True, timeout=30,
            encoding='utf-8', errors='replace',
        )

    add = run(['git', 'add', rel_path])
    if add.returncode != 0:
        raise RuntimeError(f'git add failed: {_sanitize(add.stderr, token)}')

    commit = run([
        'git', '-c', 'user.email=bot@playnexus.local', '-c', 'user.name=Play Nexus Bot',
        'commit', '-m', f'Add AI-generated game: {title}',
    ])
    if commit.returncode != 0:
        combined = commit.stdout + commit.stderr
        if 'nothing to commit' in combined:
            return {'committed': False, 'pushed': False, 'message': 'No changes to commit.'}
        raise RuntimeError(f'git commit failed: {_sanitize(combined, token)}')

    push_url = f'https://x-access-token:{token}@github.com/{repo}.git'
    push = run(['git', 'push', push_url, 'HEAD:main'])
    if push.returncode != 0:
        raise RuntimeError(f'git push failed: {_sanitize(push.stderr, token)}')

    return {'committed': True, 'pushed': True, 'message': 'Committed and pushed to main.'}


def generate_and_publish(title, genre, slug):
    """Full pipeline: AI-generate the file, write it, commit + push it.
    Raises on failure — callers should catch and treat as non-fatal to the
    game record itself, which is created regardless."""
    html = generate_game_html(title, genre)
    write_game_file(slug, html)
    return commit_and_push(slug, title)
