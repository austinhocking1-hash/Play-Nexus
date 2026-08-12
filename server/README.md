# Play Nexus server

A real backend for the site: Flask + SQLite, with actual password-hashed
accounts, session-based auth, and a database that the admin panel and the
public site both read from. This replaces the earlier static-mockup admin
panel — edits made here are real and visible to every visitor of whatever
server you run.

## Setup

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` and fill in:
- `SECRET_KEY` — generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — your real admin login, created on first run only
- `ADMIN_EMAIL` — optional, defaults to `admin@playnexus.local`

## Run

```bash
cd server
source venv/bin/activate
python3 app.py
```

Visit `http://localhost:5050` for the site and `http://localhost:5050/admin`
for the admin panel. Sign in with the `ADMIN_USERNAME`/`ADMIN_PASSWORD` you
set.

The database file `server/playnexus.db` is created automatically and is
gitignored — it's local state, not something to commit.

## What's real here

- Passwords are hashed (never stored in plaintext).
- Sessions are signed cookies tied to `SECRET_KEY`.
- Player accounts start with 500 NexBucks; redeeming a shop item deducts
  a real balance server-side (can't go negative, can't be spoofed from
  the client).
- Admin-only routes check the signed-in user's role server-side, not just
  in the UI.

## What's still missing for a production deploy

- **Hosting**: this only runs where you start it (your machine, right now).
  To make it reachable at a real domain you'd deploy it to a platform that
  runs Python servers (Render, Railway, Fly.io, a VPS, etc.) — GitHub Pages
  can't run this, it only serves static files.
- **HTTPS**: `SESSION_COOKIE_SECURE` is only enabled when `FLASK_ENV=production`
  and you're behind real TLS. Don't run this in production over plain HTTP.
- **Rate limiting / brute-force protection** on login and signup.
- **Email verification** for signups.
- **Backups** for `playnexus.db` (or migrating to a managed Postgres instance).
