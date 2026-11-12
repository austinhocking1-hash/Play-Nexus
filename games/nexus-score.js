window.NexusScore = {
  tone(freq, start, dur, type, vol) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this._ctx || (this._ctx = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      const t = ctx.currentTime + start;
      g.gain.setValueAtTime(vol || 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  },

  confetti() {
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    c.width = innerWidth; c.height = innerHeight;
    document.body.appendChild(c);
    const x = c.getContext('2d');
    const colors = ['#7c5cff', '#ff5c9e', '#2fd0ff', '#ffe9a8', '#4ade80'];
    const bits = Array.from({ length: 140 }, () => ({
      x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
      s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const end = performance.now() + 3200;
    (function frame(t) {
      x.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.r += b.vr;
        x.save(); x.translate(b.x, b.y); x.rotate(b.r);
        x.fillStyle = b.c; x.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6); x.restore();
      }
      if (t < end) requestAnimationFrame(frame); else c.remove();
    })(performance.now());
  },

  _device() {
    let id = '';
    try {
      id = localStorage.getItem('nx-vid');
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('nx-vid', id); }
    } catch (e) {}
    return id || 'nodevice-' + Math.random().toString(36).slice(2);
  },

  _esc(t) { return String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  _api(path, opts) {
    return fetch((window.PLAY_NEXUS_API_BASE || '') + path, Object.assign({ credentials: 'include', headers: { 'Content-Type': 'application/json' } }, opts));
  },
  _box() { return document.getElementById('msg') || document.getElementById('overScreen'); },
  _put(el) {
    const m = this._box(); if (!m) return;
    const btn = m.querySelector('button');
    if (btn && btn.parentNode === m) m.insertBefore(el, btn); else m.appendChild(el);
  },

  async panel(game, me, limit) {
    let items = [];
    try { items = (await (await this._api('/api/arcade/top?game=' + encodeURIComponent(game))).json()).items || []; } catch (e) {}
    const old = document.getElementById('nxBoard'); if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'nxBoard';
    el.style.cssText = 'margin:14px auto 6px;max-width:280px;text-align:left;font-size:.92rem';
    const rows = items.slice(0, limit || 10).map((r, i) => {
      const mine = me && r.name.toLowerCase() === me.toLowerCase();
      return `<div style="display:flex;justify-content:space-between;padding:3px 8px;border-radius:6px;${mine ? 'background:rgba(124,92,255,.35);font-weight:700' : ''}"><span>${i + 1}. ${this._esc(r.name)}</span><span>${Number(r.score).toLocaleString()}</span></div>`;
    }).join('') || '<div style="opacity:.7;text-align:center">No scores yet. Be the first!</div>';
    el.innerHTML = '<div style="text-align:center;font-weight:700;margin-bottom:4px">&#127942; Leaderboard</div>' + rows;
    this._put(el);
  },

  _askName(game, score, msgText) {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.id = 'nxName';
      el.style.cssText = 'margin:12px auto;max-width:280px';
      el.innerHTML = `<div style="font-weight:700">New high score! Pick a name for the leaderboard</div>
        <div style="opacity:.75;font-size:.85rem;margin:2px 0 6px">You'll only be asked once &mdash; it's used on every game.</div>
        <input id="nxNameIn" maxlength="16" placeholder="Your name" style="width:70%;padding:8px;border-radius:8px;border:1px solid #555;background:#12142b;color:#fff;font:inherit">
        <button id="nxNameGo" class="btn" style="padding:8px 12px">Save</button>
        <div id="nxNameErr" style="color:#ff8aa8;min-height:1.2em;font-size:.85rem">${msgText || ''}</div>`;
      this._put(el);
      const go = async () => {
        const err = el.querySelector('#nxNameErr');
        const name = el.querySelector('#nxNameIn').value.trim();
        err.textContent = '';
        try {
          const r = await this._api('/api/arcade/submit', { method: 'POST', body: JSON.stringify({ game, score, name, device: this._device() }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { err.textContent = d.error || 'Try another name'; return; }
          try { localStorage.setItem('nx-name', d.name); } catch (e) {}
          el.remove(); resolve(d.name);
        } catch (e) { err.textContent = 'Network error, try again'; }
      };
      el.querySelector('#nxNameGo').onclick = go;
      el.querySelector('#nxNameIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(); });
      el.querySelector('#nxNameIn').addEventListener('keyup', e => e.stopPropagation());
    });
  },

  async submit(game, score) {
    const m = this._box();
    const add = (html) => {
      if (!m) return;
      const el = document.createElement('p');
      el.style.cssText = 'margin-top:10px;font-weight:600';
      el.innerHTML = html;
      this._put(el);
    };
    let best = 0;
    try { best = Number(localStorage.getItem('nx-best-' + game) || 0); } catch (e) {}
    const isBest = score > best;
    if (isBest) { try { localStorage.setItem('nx-best-' + game, score); } catch (e) {} }

    if (isBest && best > 0) {
      add('New personal best!');
      this.confetti();
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.1, 0.18, 'square', 0.07));
    } else {
      [392, 330, 262].forEach((f, i) => this.tone(f, i * 0.12, 0.2, 'triangle', 0.06));
    }

    let top = [];
    try { top = (await (await this._api('/api/arcade/top?game=' + encodeURIComponent(game))).json()).items || []; } catch (e) {}
    const qualifies = score > 0 && (top.length < 10 || score > top[top.length - 1].score);

    let me = null;
    try {
      const r = await this._api('/api/leaderboard/submit', { method: 'POST', body: JSON.stringify({ game, score }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        let name = null;
        try { name = localStorage.getItem('nx-name'); } catch (e) {}
        if (qualifies) {
          if (name) {
            const rr = await this._api('/api/arcade/submit', { method: 'POST', body: JSON.stringify({ game, score, name, device: this._device() }) });
            if (!rr.ok) name = await this._askName(game, score, 'Your saved name is no longer available. Pick a new one.');
          } else {
            name = await this._askName(game, score);
          }
        }
        me = name;
        add('<a href="../index.html" style="color:inherit">Sign in</a> to also earn NexBucks, badges and weekly prizes!');
      } else if (r.ok) {
        try { me = ((await (await this._api('/api/auth/me')).json()).user || {}).username; } catch (e) {}
        if (d.earned) add('+' + d.earned + ' NexBucks earned!' + (d.daily_bonus ? ' (includes Daily Challenge bonus!)' : ''));
        (d.badges || []).forEach(b => {
          add(b.emoji + ' Badge unlocked: <b>' + b.name + '</b>');
          this.confetti();
          [659, 880, 1175].forEach((f, i) => this.tone(f, 0.4 + i * 0.1, 0.2, 'square', 0.06));
        });
      }
    } catch (e) {}
    this.panel(game, me, 10);
  }
};

(function () {
  const GAMES = { 'nexus-chomper': 'Nexus Chomper', 'penalty-shootout': 'Penalty Shootout', 'boss-battle': 'Boss Battle',
    'nebula-runner': 'Nebula Runner', 'castle-siege': 'Castle Siege', 'pixel-sprint': 'Pixel Sprint',
    'space-race': 'Space Race', 'puzzle-forge': 'Puzzle Forge' };
  const slug = location.pathname.split('/').pop().replace('.html', '');
  document.addEventListener('DOMContentLoaded', () => {
    if (GAMES[slug] && document.getElementById('msg')) {
      let me = null; try { me = localStorage.getItem('nx-name'); } catch (e) {}
      NexusScore.panel(GAMES[slug], me, 5);
    }
  });
})();
