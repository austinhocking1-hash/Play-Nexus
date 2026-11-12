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

  async submit(game, score) {
    const base = window.PLAY_NEXUS_API_BASE || '';
    const m = document.getElementById('msg');
    const add = (html) => {
      if (!m) return;
      const el = document.createElement('p');
      el.style.cssText = 'margin-top:10px;font-weight:600';
      el.innerHTML = html;
      m.insertBefore(el, m.querySelector('button'));
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

    try {
      const r = await fetch(base + '/api/leaderboard/submit', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, score })
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        add('<a href="../index.html" style="color:inherit">Sign in</a> to earn NexBucks, badges and a spot on the leaderboard!');
        return;
      }
      if (!r.ok) return;
      if (d.earned) add('+' + d.earned + ' NexBucks earned!' + (d.daily_bonus ? ' (includes Daily Challenge bonus!)' : ''));
      (d.badges || []).forEach(b => {
        add(b.emoji + ' Badge unlocked: <b>' + b.name + '</b>');
        this.confetti();
        [659, 880, 1175].forEach((f, i) => this.tone(f, 0.4 + i * 0.1, 0.2, 'square', 0.06));
      });
    } catch (e) {}
  }
};
