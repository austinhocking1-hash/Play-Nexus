import os
import re
import threading
import traceback

from dotenv import load_dotenv
from flask import Flask, jsonify, request, session, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash, check_password_hash

from db import get_db, close_db, init_db, now
import autofix
import gamegen

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USERNAME_RE = re.compile(r'^[a-zA-Z0-9_]{3,20}$')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('SECRET_KEY')
if not app.secret_key:
    raise RuntimeError(
        'SECRET_KEY is not set. Copy server/.env.example to server/.env, '
        'fill in real values, and load it (see server/README.md).'
    )

# Set when the frontend is hosted on a different domain than this API
# (e.g. frontend on Netlify, backend on Render). Cross-site cookies require
# SameSite=None + Secure, so both only turn on when this is configured.
ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN')
CROSS_ORIGIN = bool(ALLOWED_ORIGIN)

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='None' if CROSS_ORIGIN else 'Lax',
    SESSION_COOKIE_SECURE=CROSS_ORIGIN or os.environ.get('FLASK_ENV') == 'production',
)

app.teardown_appcontext(close_db)


@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS':
        return '', 204


@app.after_request
def add_cors_headers(response):
    if ALLOWED_ORIGIN:
        response.headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Vary'] = 'Origin'
    return response


@app.errorhandler(Exception)
def handle_unhandled_exception(e):
    # Expected control-flow (404s, aborts, etc.) aren't "bugs" — let Flask
    # handle those normally instead of trying to auto-fix them.
    if isinstance(e, HTTPException):
        return e

    tb_text = traceback.format_exc()
    app.logger.error('Unhandled exception on %s:\n%s', request.path, tb_text)

    try:
        frames = traceback.extract_tb(e.__traceback__)
        our_frames = [
            f for f in frames
            if os.path.dirname(os.path.abspath(f.filename)) == os.path.dirname(os.path.abspath(__file__))
        ]
        if our_frames:
            target_file = our_frames[-1].filename
            threading.Thread(
                target=autofix.fix_server_file,
                args=(target_file, str(e), tb_text),
                daemon=True,
            ).start()
    except Exception:
        app.logger.exception('Failed to dispatch autofix for the exception above')

    return jsonify(error='Internal server error'), 500


# ---------- helpers ----------

def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    db = get_db()
    return db.execute('SELECT * FROM users WHERE id = ?', (uid,)).fetchone()


def require_login():
    user = current_user()
    if not user:
        return None, (jsonify(error='Not signed in'), 401)
    return user, None


def require_admin():
    user, err = require_login()
    if err:
        return None, err
    if user['role'] != 'admin':
        return None, (jsonify(error='Admin access required'), 403)
    return user, None


def user_public(u):
    return {
        'id': u['id'],
        'username': u['username'],
        'email': u['email'],
        'role': u['role'],
        'nexbucks': u['nexbucks'],
    }


# ---------- auth ----------

@app.post('/api/auth/signup')
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not USERNAME_RE.match(username):
        return jsonify(error='Username must be 3-20 characters (letters, numbers, underscore).'), 400
    if not EMAIL_RE.match(email):
        return jsonify(error='Enter a valid email address.'), 400
    if len(password) < 8:
        return jsonify(error='Password must be at least 8 characters.'), 400

    db = get_db()
    exists = db.execute(
        'SELECT id FROM users WHERE username = ? OR email = ?', (username, email)
    ).fetchone()
    if exists:
        return jsonify(error='Username or email already in use.'), 409

    cur = db.execute(
        'INSERT INTO users (username, email, password_hash, role, nexbucks, created_at) '
        "VALUES (?, ?, ?, 'player', 500, ?)",
        (username, email, generate_password_hash(password, method='pbkdf2:sha256'), now()),
    )
    db.commit()
    session.clear()
    session['user_id'] = cur.lastrowid
    user = db.execute('SELECT * FROM users WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(user=user_public(user)), 201


@app.post('/api/auth/login')
def login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get('username') or '').strip()
    password = data.get('password') or ''

    db = get_db()
    user = db.execute(
        'SELECT * FROM users WHERE username = ? OR email = ?',
        (identifier, identifier.lower()),
    ).fetchone()
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify(error='Invalid username or password.'), 401

    session.clear()
    session['user_id'] = user['id']
    return jsonify(user=user_public(user))


@app.post('/api/auth/logout')
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get('/api/auth/me')
def me():
    user = current_user()
    if not user:
        return jsonify(user=None)
    return jsonify(user=user_public(user))


# ---------- generic resource CRUD (games, shop, challenges) ----------

def slugify(text):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return slug or 'game'


RESOURCE_CONFIG = {
    'games': {
        'table': 'games',
        'fields': ['title', 'genre', 'status', 'slug'],
        'required': ['title', 'genre'],
    },
    'shop': {
        'table': 'shop_items',
        'fields': ['name', 'category', 'price'],
        'required': ['name', 'category', 'price'],
    },
    'challenges': {
        'table': 'challenges',
        'fields': ['name', 'type', 'reward'],
        'required': ['name', 'type', 'reward'],
    },
}


def list_resource(resource):
    cfg = RESOURCE_CONFIG[resource]
    db = get_db()
    rows = db.execute(f"SELECT * FROM {cfg['table']} ORDER BY id").fetchall()
    return jsonify(items=[dict(r) for r in rows])


def create_resource(resource):
    _, err = require_admin()
    if err:
        return err
    cfg = RESOURCE_CONFIG[resource]
    data = request.get_json(silent=True) or {}
    for field in cfg['required']:
        if not str(data.get(field, '')).strip():
            return jsonify(error=f'"{field}" is required.'), 400

    values = {f: data.get(f) for f in cfg['fields']}
    if 'price' in values:
        try:
            values['price'] = int(values['price'])
        except (TypeError, ValueError):
            return jsonify(error='"price" must be a number.'), 400
    if 'status' in cfg['fields'] and not values.get('status'):
        values['status'] = 'Live'
    if 'slug' in cfg['fields'] and not str(values.get('slug') or '').strip():
        values['slug'] = slugify(values.get('title') or '')

    db = get_db()
    cols = ', '.join(values.keys())
    placeholders = ', '.join('?' for _ in values)
    cur = db.execute(
        f"INSERT INTO {cfg['table']} ({cols}) VALUES ({placeholders})",
        tuple(values.values()),
    )
    db.commit()
    row = db.execute(f"SELECT * FROM {cfg['table']} WHERE id = ?", (cur.lastrowid,)).fetchone()
    item = dict(row)

    generation = None
    if resource == 'games':
        try:
            generation = gamegen.generate_and_publish(item['title'], item['genre'], item['slug'])
            generation['ok'] = True
        except Exception as e:
            tb = traceback.format_exc()
            app.logger.error('Game generation failed:\n%s', tb)
            generation = {'ok': False, 'message': str(e), 'traceback': tb}

    return jsonify(item=item, generation=generation), 201


@app.post('/api/games/<int:game_id>/generate')
def regenerate_game(game_id):
    _, err = require_admin()
    if err:
        return err
    db = get_db()
    game = db.execute('SELECT * FROM games WHERE id = ?', (game_id,)).fetchone()
    if not game:
        return jsonify(error='Not found.'), 404
    try:
        result = gamegen.generate_and_publish(game['title'], game['genre'], game['slug'])
        result['ok'] = True
        return jsonify(generation=result)
    except Exception as e:
        tb = traceback.format_exc()
        app.logger.error('Game regeneration failed:\n%s', tb)
        return jsonify(generation={'ok': False, 'message': str(e), 'traceback': tb}, error=str(e)), 500


@app.post('/api/games/<slug>/report-error')
def report_game_error(slug):
    """A game page calls this automatically when it hits a JS error. No
    auth required — any player's browser can trigger it — but it's rate
    limited per (game, error) via autofix's cooldown, and the actual fix
    runs in the background so this always responds immediately."""
    slug = re.sub(r'[^a-z0-9-]', '', (slug or '')[:60])
    data = request.get_json(silent=True) or {}
    message = str(data.get('message') or '')[:500]
    stack = str(data.get('stack') or '')[:2000]
    if slug and message:
        threading.Thread(
            target=autofix.fix_game_file,
            args=(slug, message, stack),
            daemon=True,
        ).start()
    return jsonify(ok=True)


def update_resource(resource, item_id):
    _, err = require_admin()
    if err:
        return err
    cfg = RESOURCE_CONFIG[resource]
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.execute(f"SELECT * FROM {cfg['table']} WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        return jsonify(error='Not found.'), 404

    values = {}
    for f in cfg['fields']:
        if f in data:
            values[f] = data[f]
    if 'price' in values:
        try:
            values['price'] = int(values['price'])
        except (TypeError, ValueError):
            return jsonify(error='"price" must be a number.'), 400

    if values:
        set_clause = ', '.join(f'{k} = ?' for k in values)
        db.execute(
            f"UPDATE {cfg['table']} SET {set_clause} WHERE id = ?",
            (*values.values(), item_id),
        )
        db.commit()
    row = db.execute(f"SELECT * FROM {cfg['table']} WHERE id = ?", (item_id,)).fetchone()
    return jsonify(item=dict(row))


def delete_resource(resource, item_id):
    _, err = require_admin()
    if err:
        return err
    cfg = RESOURCE_CONFIG[resource]
    db = get_db()
    db.execute(f"DELETE FROM {cfg['table']} WHERE id = ?", (item_id,))
    db.commit()
    return jsonify(ok=True)


for _resource in RESOURCE_CONFIG:
    app.add_url_rule(f'/api/{_resource}', f'list_{_resource}', lambda r=_resource: list_resource(r), methods=['GET'])
    app.add_url_rule(f'/api/{_resource}', f'create_{_resource}', lambda r=_resource: create_resource(r), methods=['POST'])
    app.add_url_rule(f'/api/{_resource}/<int:item_id>', f'update_{_resource}', lambda item_id, r=_resource: update_resource(r, item_id), methods=['PUT'])
    app.add_url_rule(f'/api/{_resource}/<int:item_id>', f'delete_{_resource}', lambda item_id, r=_resource: delete_resource(r, item_id), methods=['DELETE'])


# ---------- leaderboard ----------

@app.get('/api/health')
def health():
    db = get_db()
    players = db.execute("SELECT COUNT(*) FROM users WHERE role = 'player'").fetchone()[0]
    return jsonify(status='ok', players=players)


@app.get('/api/admin/stats')
def admin_stats():
    _, err = require_admin()
    if err:
        return err
    db = get_db()
    player_count = db.execute("SELECT COUNT(*) FROM users WHERE role = 'player'").fetchone()[0]
    return jsonify(players=player_count)


@app.get('/api/leaderboard')
def leaderboard_list():
    db = get_db()
    rows = db.execute(
        'SELECT * FROM leaderboard ORDER BY score DESC LIMIT 100'
    ).fetchall()
    return jsonify(items=[dict(r) for r in rows])


@app.post('/api/leaderboard')
def leaderboard_create():
    _, err = require_admin()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    player = (data.get('player_name') or '').strip()
    game = (data.get('game') or '').strip()
    try:
        score = int(data.get('score'))
    except (TypeError, ValueError):
        return jsonify(error='"score" must be a number.'), 400
    if not player or not game:
        return jsonify(error='player_name and game are required.'), 400

    db = get_db()
    cur = db.execute(
        'INSERT INTO leaderboard (user_id, player_name, game, score) VALUES (NULL, ?, ?, ?)',
        (player, game, score),
    )
    db.commit()
    row = db.execute('SELECT * FROM leaderboard WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(item=dict(row)), 201


@app.put('/api/leaderboard/<int:entry_id>')
def leaderboard_update(entry_id):
    _, err = require_admin()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.execute('SELECT * FROM leaderboard WHERE id = ?', (entry_id,)).fetchone()
    if not existing:
        return jsonify(error='Not found.'), 404
    player = (data.get('player_name') or existing['player_name']).strip()
    game = (data.get('game') or existing['game']).strip()
    score = data.get('score', existing['score'])
    try:
        score = int(score)
    except (TypeError, ValueError):
        return jsonify(error='"score" must be a number.'), 400
    db.execute(
        'UPDATE leaderboard SET player_name = ?, game = ?, score = ? WHERE id = ?',
        (player, game, score, entry_id),
    )
    db.commit()
    row = db.execute('SELECT * FROM leaderboard WHERE id = ?', (entry_id,)).fetchone()
    return jsonify(item=dict(row))


@app.delete('/api/leaderboard/<int:entry_id>')
def leaderboard_delete(entry_id):
    _, err = require_admin()
    if err:
        return err
    db = get_db()
    db.execute('DELETE FROM leaderboard WHERE id = ?', (entry_id,))
    db.commit()
    return jsonify(ok=True)


@app.post('/api/leaderboard/submit')
def leaderboard_submit():
    """A logged-in player reports their own score (e.g. from a game page)."""
    user, err = require_login()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    game = (data.get('game') or '').strip()
    try:
        score = int(data.get('score'))
    except (TypeError, ValueError):
        return jsonify(error='"score" must be a number.'), 400
    if not game:
        return jsonify(error='"game" is required.'), 400

    db = get_db()
    existing = db.execute(
        'SELECT * FROM leaderboard WHERE user_id = ? AND game = ?', (user['id'], game)
    ).fetchone()
    if existing:
        if score > existing['score']:
            db.execute('UPDATE leaderboard SET score = ? WHERE id = ?', (score, existing['id']))
            db.commit()
    else:
        db.execute(
            'INSERT INTO leaderboard (user_id, player_name, game, score) VALUES (?, ?, ?, ?)',
            (user['id'], user['username'], game, score),
        )
        db.commit()
    return jsonify(ok=True)


# ---------- shop redemption (real balance, tied to a real account) ----------

@app.post('/api/shop/<int:item_id>/redeem')
def redeem_item(item_id):
    user, err = require_login()
    if err:
        return err
    db = get_db()
    item = db.execute('SELECT * FROM shop_items WHERE id = ?', (item_id,)).fetchone()
    if not item:
        return jsonify(error='Item not found.'), 404
    if user['nexbucks'] < item['price']:
        return jsonify(error='Not enough NexBucks.'), 400

    new_balance = user['nexbucks'] - item['price']
    db.execute('UPDATE users SET nexbucks = ? WHERE id = ?', (new_balance, user['id']))
    db.execute(
        'INSERT INTO purchases (user_id, item_id, item_name, price_paid, redeemed_at) '
        'VALUES (?, ?, ?, ?, ?)',
        (user['id'], item['id'], item['name'], item['price'], now()),
    )
    db.commit()
    return jsonify(ok=True, nexbucks=new_balance, item=dict(item))


@app.get('/api/shop/purchases')
def my_purchases():
    user, err = require_login()
    if err:
        return err
    db = get_db()
    rows = db.execute(
        'SELECT * FROM purchases WHERE user_id = ? ORDER BY id DESC', (user['id'],)
    ).fetchall()
    return jsonify(items=[dict(r) for r in rows])


# ---------- static file serving (the existing site + admin panel) ----------

@app.get('/')
def index():
    return send_from_directory(ROOT_DIR, 'index.html', max_age=0)


@app.get('/admin')
@app.get('/admin/')
def admin_index():
    return send_from_directory(os.path.join(ROOT_DIR, 'admin'), 'index.html', max_age=0)


@app.get('/<path:path>')
def static_files(path):
    return send_from_directory(ROOT_DIR, path, max_age=0)


init_db(app)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    debug = os.environ.get('FLASK_ENV') != 'production'
    app.run(host='0.0.0.0', port=port, debug=debug)
