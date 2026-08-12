import os
import sqlite3
from datetime import datetime, timezone

from flask import g
from werkzeug.security import generate_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'playnexus.db')

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    nexbucks INTEGER NOT NULL DEFAULT 500,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    genre TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Live',
    slug TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    reward TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    player_name TEXT NOT NULL,
    game TEXT NOT NULL,
    score INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    price_paid INTEGER NOT NULL,
    redeemed_at TEXT NOT NULL
);
"""

DEFAULT_GAMES = [
    ('Nebula Runner', 'Arcade', 'Live', 'nebula-runner'),
    ('Puzzle Forge', 'Puzzle', 'Live', 'puzzle-forge'),
    ('Castle Siege', 'Strategy', 'Live', 'castle-siege'),
    ('Pixel Sprint', 'Platformer', 'Live', 'pixel-sprint'),
]

DEFAULT_SHOP = [
    ('Nova Ranger Skin', 'Skin', 800),
    ('Double XP Token', 'Boost', 350),
    ('Siege Master Badge', 'Badge', 1200),
    ('Retro Pixel Theme', 'Theme', 600),
]

DEFAULT_CHALLENGES = [
    ('Asteroid Gauntlet', 'Daily', '+150 XP'),
    ('Chain Reaction', 'Weekly', '+500 XP'),
    ('Siege Breaker', 'Event', 'Exclusive Badge'),
]

DEFAULT_LEADERBOARD = [
    (None, 'NovaStrike', 'Nebula Runner', 98430),
    (None, 'ByteBender', 'Puzzle Forge', 91110),
    (None, 'ShadowVex', 'Castle Siege', 87905),
    (None, 'PixelPhoenix', 'Pixel Sprint', 82340),
    (None, 'QuantumJinx', 'Nebula Runner', 79215),
]


def now():
    return datetime.now(timezone.utc).isoformat()


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db(app):
    with app.app_context():
        db = sqlite3.connect(DB_PATH)
        db.executescript(SCHEMA)

        if db.execute('SELECT COUNT(*) FROM games').fetchone()[0] == 0:
            db.executemany(
                'INSERT INTO games (title, genre, status, slug) VALUES (?, ?, ?, ?)',
                DEFAULT_GAMES,
            )
        if db.execute('SELECT COUNT(*) FROM shop_items').fetchone()[0] == 0:
            db.executemany(
                'INSERT INTO shop_items (name, category, price) VALUES (?, ?, ?)',
                DEFAULT_SHOP,
            )
        if db.execute('SELECT COUNT(*) FROM challenges').fetchone()[0] == 0:
            db.executemany(
                'INSERT INTO challenges (name, type, reward) VALUES (?, ?, ?)',
                DEFAULT_CHALLENGES,
            )
        if db.execute('SELECT COUNT(*) FROM leaderboard').fetchone()[0] == 0:
            db.executemany(
                'INSERT INTO leaderboard (user_id, player_name, game, score) VALUES (?, ?, ?, ?)',
                DEFAULT_LEADERBOARD,
            )

        # Seed the admin account from environment variables, never from
        # a hardcoded credential in source. Only runs once per fresh DB.
        admin_exists = db.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'admin'"
        ).fetchone()[0]
        if admin_exists == 0:
            admin_user = os.environ.get('ADMIN_USERNAME')
            admin_pass = os.environ.get('ADMIN_PASSWORD')
            admin_email = os.environ.get('ADMIN_EMAIL', 'admin@playnexus.local')
            if admin_user and admin_pass:
                db.execute(
                    'INSERT INTO users (username, email, password_hash, role, nexbucks, created_at) '
                    "VALUES (?, ?, ?, 'admin', 0, ?)",
                    (admin_user, admin_email, generate_password_hash(admin_pass, method='pbkdf2:sha256'), now()),
                )
                print(f"[playnexus] Seeded admin account '{admin_user}' from environment.")
            else:
                print(
                    "[playnexus] WARNING: No admin account exists and "
                    "ADMIN_USERNAME/ADMIN_PASSWORD are not set. Set them in "
                    "server/.env and restart to create the first admin."
                )

        db.commit()
        db.close()
