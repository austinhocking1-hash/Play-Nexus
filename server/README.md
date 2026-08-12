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

## Split hosting: Netlify (frontend) + Render (backend)

If the static site (`index.html`, `admin/`, `games/`) is deployed on Netlify
separately from this backend, the two are on different domains, so:

- The frontend needs to know the backend's URL. Edit `config.js` at the repo
  root and set `window.PLAY_NEXUS_API_BASE` to your Render backend's URL
  (e.g. `'https://play-nexus.onrender.com'`), then redeploy the Netlify site.
- The backend needs to allow that origin and use cross-site cookies. Set
  `ALLOWED_ORIGIN` in the backend's env (already defaulted to
  `https://letsplaynexus.netlify.app` in `render.yaml`) to your Netlify
  URL. This flips the session cookie to `SameSite=None; Secure`, which
  **requires HTTPS on both sides** — Netlify and Render both give you that
  by default, so no extra setup needed there.
- If your Netlify URL ever changes, update `ALLOWED_ORIGIN` on Render to
  match, or cross-origin requests (login, signup, admin panel) will fail.

If instead frontend and backend are deployed together as one Render service
(the simpler option), leave `config.js` as `''` and don't set `ALLOWED_ORIGIN`
— everything runs same-origin and none of this is needed.

## Deploying to Render

The repo includes `render.yaml` at the root, so Render can mostly configure
itself. Steps only you can do (they need your own Render account):

1. Go to [render.com](https://render.com) and sign up / log in (e.g. with
   your GitHub account).
2. **New +** → **Blueprint** → connect the `Play-Nexus` GitHub repo. Render
   will read `render.yaml` and propose a `play-nexus` web service.
3. Before the first deploy, set the secret env vars it asks for (these are
   marked `sync: false` in `render.yaml` so Render prompts for them instead
   of storing them in the repo):
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `ADMIN_EMAIL` (optional)

   `SECRET_KEY` is generated for you automatically.
4. Deploy. Render builds with `pip install -r server/requirements.txt` and
   runs `gunicorn app:app` from `server/`. Once it's up, your admin panel
   is at `https://<your-service-name>.onrender.com/admin`.

**Free tier caveat**: Render's free plan doesn't include the persistent
disk declared in `render.yaml` (that needs a paid plan) — on the free tier,
`playnexus.db` gets wiped on every redeploy/restart, so games/shop/leaderboard
edits and player accounts won't survive. For anything real, either upgrade
to a plan with a persistent disk, or migrate to a managed database (e.g.
Render's managed Postgres) instead of SQLite.

## What's still missing for a production deploy

- **Persistent storage**: see the free-tier caveat above — SQLite on
  ephemeral disk will lose data on every restart.
- **HTTPS**: `SESSION_COOKIE_SECURE` is only enabled when `FLASK_ENV=production`
  and you're behind real TLS. Render provides HTTPS automatically; if you
  deploy elsewhere, make sure TLS is in front of the app.
- **Rate limiting / brute-force protection** on login and signup.
- **Email verification** for signups.
- **Backups** for `playnexus.db` (or migrating to a managed Postgres instance).
