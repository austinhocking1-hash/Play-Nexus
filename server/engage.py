"""Engagement features: badges, friends, notifications, daily challenge,
and automatic weekly prize rotation."""
import random
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

GAMES = ['Nexus Chomper', 'Penalty Shootout', 'Boss Battle', 'Nebula Runner',
         'Castle Siege', 'Pixel Sprint', 'Space Race', 'Puzzle Forge']

DAILY_TARGETS = {
    'Nexus Chomper': 800, 'Penalty Shootout': 400, 'Boss Battle': 1000, 'Nebula Runner': 150,
    'Castle Siege': 150, 'Pixel Sprint': 200, 'Space Race': 100, 'Puzzle Forge': 600,
}
SCORE_CAPS = {
    'Nexus Chomper': 100000, 'Penalty Shootout': 500, 'Boss Battle': 3000, 'Nebula Runner': 50000,
    'Castle Siege': 50000, 'Pixel Sprint': 50000, 'Space Race': 50000, 'Puzzle Forge': 1000,
}
DAILY_BONUS = 100
WEEK = timedelta(days=7)

BADGES = {
    'first_game': ('First Steps', '🎮', 'Finish your first game'),
    'plays_10': ('Regular', '🔁', 'Finish 10 games'),
    'plays_50': ('Dedicated', '🔥', 'Finish 50 games'),
    'all_rounder': ('All-Rounder', '🌈', 'Play all 8 games'),
    'streak_3': ('3-Day Streak', '📅', 'Claim daily rewards 3 days in a row'),
    'streak_7': ('Week Warrior', '⚡', 'Claim daily rewards 7 days in a row'),
    'streak_30': ('Unstoppable', '👑', 'Claim daily rewards 30 days in a row'),
    'chomper_pro': ('Chomp Champ', '🟣', 'Score 3000+ in Nexus Chomper'),
    'boss_slayer': ('Boss Slayer', '⚔️', 'Defeat the boss'),
    'sharpshooter': ('Sharpshooter', '⚽', 'Win a Penalty Shootout with 450+ points'),
    'daily_challenger': ('Challenger', '🎯', 'Beat a daily challenge'),
    'social': ('Friendly', '🤝', 'Follow another player'),
    'weekly_champ': ('Weekly Champion', '🏆', 'Win the weekly prize'),
}


def _today(offset=0):
    return (datetime.now(timezone.utc) + timedelta(days=offset)).strftime('%Y-%m-%d')


def daily_challenge(day=None):
    day = day or _today()
    n = datetime.strptime(day, '%Y-%m-%d').toordinal()
    game = GAMES[n % len(GAMES)]
    return {'day': day, 'game': game, 'target': DAILY_TARGETS[game], 'bonus': DAILY_BONUS}


def award(db, user_id, badge):
    if badge not in BADGES:
        return None
    cur = db.execute('INSERT OR IGNORE INTO user_badges (user_id, badge, earned_at) VALUES (?, ?, ?)',
                     (user_id, badge, datetime.now(timezone.utc).isoformat()))
    if cur.rowcount:
        return badge_info(badge)
    return None


def badge_info(b):
    name, emoji, desc = BADGES[b]
    return {'id': b, 'name': name, 'emoji': emoji, 'desc': desc}


def notify(db, user_id, text):
    db.execute('INSERT INTO notifications (user_id, text, created_at) VALUES (?, ?, ?)',
               (user_id, text[:200], datetime.now(timezone.utc).isoformat()))


def after_score(db, user, game, score, old_best):
    """Run once per submitted score. Returns dict with new badges / bonus."""
    uid = user['id']
    new_badges = []
    db.execute('UPDATE users SET plays = plays + 1 WHERE id = ?', (uid,))
    plays = user['plays'] + 1

    def grant(b):
        info = award(db, uid, b)
        if info:
            new_badges.append(info)

    grant('first_game')
    if plays >= 10:
        grant('plays_10')
    if plays >= 50:
        grant('plays_50')
    distinct = db.execute('SELECT COUNT(DISTINCT game) FROM leaderboard WHERE user_id = ?', (uid,)).fetchone()[0]
    if distinct >= len(GAMES):
        grant('all_rounder')
    if game == 'Nexus Chomper' and score >= 3000:
        grant('chomper_pro')
    if game == 'Boss Battle' and score >= 1000:
        grant('boss_slayer')
    if game == 'Penalty Shootout' and score >= 450:
        grant('sharpshooter')

    bonus = 0
    ch = daily_challenge()
    if game == ch['game'] and score >= ch['target']:
        cur = db.execute('INSERT OR IGNORE INTO daily_challenge_claims (user_id, day) VALUES (?, ?)',
                         (uid, ch['day']))
        if cur.rowcount:
            bonus = ch['bonus']
            db.execute('UPDATE users SET nexbucks = nexbucks + ? WHERE id = ?', (bonus, uid))
            grant('daily_challenger')

    # tell followers whose score on this game this player just passed
    if score > old_best:
        rows = db.execute(
            'SELECT f.follower_id FROM follows f JOIN leaderboard l ON l.user_id = f.follower_id '
            'WHERE f.followed_id = ? AND l.game = ? AND l.score < ? AND l.score >= ?',
            (uid, game, score, old_best)).fetchall()
        for r in rows:
            notify(db, r['follower_id'], f"{user['username']} just beat your {game} score!")
    db.commit()
    return {'badges': new_badges, 'daily_bonus': bonus}


def award_streak_badges(db, user_id, streak):
    out = []
    for n, b in ((3, 'streak_3'), (7, 'streak_7'), (30, 'streak_30')):
        if streak >= n:
            info = award(db, user_id, b)
            if info:
                out.append(info)
    return out


# ---------- weekly prize rotation ----------

def end_event(db, ev):
    top = db.execute('SELECT * FROM weekly_scores WHERE event_id = ? ORDER BY score DESC LIMIT 1',
                     (ev['id'],)).fetchone()
    name, score = (top['player_name'], top['score']) if top else ('No winner', 0)
    if top:
        if ev['bonus_nexbucks']:
            db.execute('UPDATE users SET nexbucks = nexbucks + ? WHERE id = ?',
                       (ev['bonus_nexbucks'], top['user_id']))
        db.execute('UPDATE users SET unseen_win = ? WHERE id = ?',
                   (f"{ev['prize']}|{ev['game']}", top['user_id']))
        award(db, top['user_id'], 'weekly_champ')
        notify(db, top['user_id'], f"You won the weekly prize: {ev['prize']}!")
    db.execute("UPDATE weekly_events SET status = 'ended', ended_at = ?, winner_name = ?, winner_score = ? WHERE id = ?",
               (datetime.now(timezone.utc).isoformat(), name, score, ev['id']))
    db.commit()
    return {'winner': name, 'score': score, 'prize': ev['prize']}


def start_event(db, prize, bonus, game=None):
    if not game:
        last = db.execute('SELECT game FROM weekly_events ORDER BY id DESC LIMIT 1').fetchone()
        choices = [g for g in GAMES if not last or g != last['game']]
        game = random.choice(choices)
    db.execute('INSERT INTO weekly_events (game, prize, bonus_nexbucks, started_at) VALUES (?, ?, ?, ?)',
               (game, prize, bonus, datetime.now(timezone.utc).isoformat()))
    db.commit()
    return game


def _setting(db, key, default):
    r = db.execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
    return r['value'] if r else default


def ensure_weekly(db):
    """Lazy auto-rotation (no background scheduler on free hosting): called on
    requests. Ends a week once it is 7 days old and starts the next one."""
    if _setting(db, 'auto_weekly', '1') != '1':
        return
    ev = db.execute("SELECT * FROM weekly_events WHERE status = 'active' ORDER BY id DESC LIMIT 1").fetchone()
    if ev:
        try:
            started = datetime.fromisoformat(ev['started_at'])
        except ValueError:
            return
        if datetime.now(timezone.utc) - started < WEEK:
            return
        end_event(db, ev)
    nxt = db.execute('SELECT * FROM prize_queue ORDER BY id LIMIT 1').fetchone()
    if nxt:
        db.execute('DELETE FROM prize_queue WHERE id = ?', (nxt['id'],))
        prize, bonus = nxt['prize'], nxt['bonus']
    else:
        prize, bonus = 'Mystery Prize', 500
    start_event(db, prize, bonus)


# ---------- routes ----------

def register(app, get_db, require_login, require_admin):
    @app.get('/api/daily-challenge')
    def daily_challenge_route():
        ch = daily_challenge()
        done = False
        from flask import session
        uid = session.get('user_id')
        if uid:
            done = bool(get_db().execute('SELECT 1 FROM daily_challenge_claims WHERE user_id = ? AND day = ?',
                                         (uid, ch['day'])).fetchone())
        return jsonify(**ch, done=done)

    @app.get('/api/badges')
    def badges_list():
        return jsonify(badges=[badge_info(b) for b in BADGES])

    @app.get('/api/profile/<username>')
    def profile(username):
        db = get_db()
        u = db.execute('SELECT * FROM users WHERE username = ? COLLATE NOCASE', (username,)).fetchone()
        if not u:
            return jsonify(error='Player not found'), 404
        badges = [badge_info(r['badge']) for r in
                  db.execute('SELECT badge FROM user_badges WHERE user_id = ? ORDER BY earned_at', (u['id'],))
                  if r['badge'] in BADGES]
        scores = [dict(r) for r in db.execute(
            'SELECT game, score FROM leaderboard WHERE user_id = ? ORDER BY score DESC', (u['id'],))]
        followers = db.execute('SELECT COUNT(*) FROM follows WHERE followed_id = ?', (u['id'],)).fetchone()[0]
        following = db.execute('SELECT COUNT(*) FROM follows WHERE follower_id = ?', (u['id'],)).fetchone()[0]
        wins = db.execute("SELECT COUNT(*) FROM weekly_events WHERE winner_name = ? AND status = 'ended'",
                          (u['username'],)).fetchone()[0]
        from flask import session
        me = session.get('user_id')
        is_following = bool(me and db.execute(
            'SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?', (me, u['id'])).fetchone())
        friends = []
        if me == u['id']:
            friends = [dict(r) for r in db.execute(
                'SELECT u.username, COALESCE(SUM(l.score), 0) AS total FROM follows f '
                'JOIN users u ON u.id = f.followed_id LEFT JOIN leaderboard l ON l.user_id = u.id '
                'WHERE f.follower_id = ? GROUP BY u.id ORDER BY total DESC', (u['id'],))]
        return jsonify(username=u['username'], joined=u['created_at'][:10], streak=u['streak'],
                       plays=u['plays'], badges=badges, scores=scores, followers=followers,
                       following=following, weekly_wins=wins, is_following=is_following,
                       is_me=(me == u['id']), friends=friends)

    @app.post('/api/follow')
    def follow():
        user, err = require_login()
        if err:
            return err
        name = str((request.get_json(silent=True) or {}).get('username') or '').strip()
        db = get_db()
        target = db.execute('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE', (name,)).fetchone()
        if not target:
            return jsonify(error='Player not found'), 404
        if target['id'] == user['id']:
            return jsonify(error="You can't follow yourself"), 400
        db.execute('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)',
                   (user['id'], target['id']))
        badge = award(db, user['id'], 'social')
        db.commit()
        return jsonify(ok=True, badges=[badge] if badge else [])

    @app.post('/api/unfollow')
    def unfollow():
        user, err = require_login()
        if err:
            return err
        name = str((request.get_json(silent=True) or {}).get('username') or '').strip()
        db = get_db()
        target = db.execute('SELECT id FROM users WHERE username = ? COLLATE NOCASE', (name,)).fetchone()
        if target:
            db.execute('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', (user['id'], target['id']))
            db.commit()
        return jsonify(ok=True)

    @app.get('/api/notifications')
    def notifications():
        user, err = require_login()
        if err:
            return err
        rows = get_db().execute('SELECT id, text, created_at FROM notifications WHERE user_id = ? AND seen = 0 '
                                'ORDER BY id DESC LIMIT 10', (user['id'],)).fetchall()
        return jsonify(items=[dict(r) for r in rows])

    @app.post('/api/notifications/seen')
    def notifications_seen():
        user, err = require_login()
        if err:
            return err
        db = get_db()
        db.execute('UPDATE notifications SET seen = 1 WHERE user_id = ?', (user['id'],))
        db.commit()
        return jsonify(ok=True)

    @app.post('/api/ack-win')
    def ack_win():
        user, err = require_login()
        if err:
            return err
        db = get_db()
        db.execute("UPDATE users SET unseen_win = '' WHERE id = ?", (user['id'],))
        db.commit()
        return jsonify(ok=True)

    # ----- admin: prize queue + auto rotation -----
    @app.get('/api/admin/prizes')
    def prizes_list():
        _, err = require_admin()
        if err:
            return err
        db = get_db()
        rows = db.execute('SELECT id, prize, bonus FROM prize_queue ORDER BY id').fetchall()
        return jsonify(items=[dict(r) for r in rows], auto=_setting(db, 'auto_weekly', '1') == '1')

    @app.post('/api/admin/prizes')
    def prizes_add():
        _, err = require_admin()
        if err:
            return err
        data = request.get_json(silent=True) or {}
        prize = str(data.get('prize') or '').strip()[:120]
        try:
            bonus = max(0, int(data.get('bonus') or 0))
        except (TypeError, ValueError):
            return jsonify(error='Bonus must be a number'), 400
        if not prize:
            return jsonify(error='Enter a prize'), 400
        db = get_db()
        db.execute('INSERT INTO prize_queue (prize, bonus) VALUES (?, ?)', (prize, bonus))
        db.commit()
        return jsonify(ok=True), 201

    @app.delete('/api/admin/prizes/<int:pid>')
    def prizes_delete(pid):
        _, err = require_admin()
        if err:
            return err
        db = get_db()
        db.execute('DELETE FROM prize_queue WHERE id = ?', (pid,))
        db.commit()
        return jsonify(ok=True)

    @app.post('/api/admin/weekly/auto')
    def weekly_auto():
        _, err = require_admin()
        if err:
            return err
        on = '1' if (request.get_json(silent=True) or {}).get('enabled') else '0'
        db = get_db()
        db.execute('INSERT INTO settings (key, value) VALUES (?, ?) '
                   'ON CONFLICT(key) DO UPDATE SET value = excluded.value', ('auto_weekly', on))
        db.commit()
        return jsonify(ok=True, auto=on == '1')
