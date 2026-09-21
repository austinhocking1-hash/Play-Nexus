window.NexusScore = {
  async submit(game, score) {
    const base = window.PLAY_NEXUS_API_BASE || '';
    try {
      const r = await fetch(base + '/api/leaderboard/submit', {
        method: 'POST', credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({game, score})
      });
      const d = await r.json().catch(() => ({}));
      const el = document.createElement('p');
      el.style.cssText = 'margin-top:12px;font-weight:600';
      if (r.ok && d.earned) el.textContent = '+' + d.earned + ' NexBucks earned!';
      else if (r.status === 401) el.innerHTML = '<a href="../index.html" style="color:inherit">Sign in</a> to earn NexBucks and get on the leaderboard!';
      else return;
      const m = document.getElementById('msg');
      if (m) m.insertBefore(el, m.querySelector('button'));
    } catch (e) {}
  }
};
