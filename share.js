window.NexusShare = {
  async _name() {
    try {
      const r = await fetch((window.PLAY_NEXUS_API_BASE || '') + '/api/auth/me', { credentials: 'include' });
      const d = await r.json();
      if (d.user) return d.user.username;
    } catch (e) {}
    return '';
  },

  async open(heading) {
    const old = document.getElementById('nxShareModal'); if (old) old.remove();
    const name = await this._name();
    const link = location.origin + '/' + (name ? '?ref=' + encodeURIComponent(name) : '');
    const text = 'I\'ve been playing Play Nexus, free games with daily challenges and weekly prizes. Come play!';
    const q = encodeURIComponent(text + ' ' + link);
    const wrap = document.createElement('div');
    wrap.id = 'nxShareModal';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,6,18,.75)';
    const btn = 'display:block;padding:10px 14px;border-radius:10px;border:1px solid #2a2d54;background:#1e2142;color:#fff;text-decoration:none;font:600 .95rem -apple-system,Helvetica,Arial,sans-serif;cursor:pointer;text-align:center';
    wrap.innerHTML = `<div style="width:100%;max-width:380px;background:#171933;border:1px solid #7c5cff;border-radius:16px;padding:20px;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center">
      <div style="font-size:1.25rem;font-weight:800">${heading || 'Love Play Nexus? Spread the word!'}</div>
      <p style="color:#a7abc9;margin:8px 0 14px">${name ? 'Friends who join with your link get +100 NexBucks, and so do you.' : 'Share it with a friend who likes games.'}</p>
      <input id="nxShareLink" readonly value="${link}" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #2a2d54;background:#0f1120;color:#fff;font:inherit;margin-bottom:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button id="nxShareCopy" style="${btn}">Copy link</button>
        <button id="nxShareNative" style="${btn}">Share&hellip;</button>
        <a style="${btn}" target="_blank" rel="noopener" href="https://wa.me/?text=${q}">WhatsApp</a>
        <a style="${btn}" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${q}">X / Twitter</a>
        <a style="${btn}" href="sms:?&body=${q}">Text message</a>
        <a style="${btn}" target="_blank" rel="noopener" href="https://www.reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent('Play Nexus: free games with weekly prizes')}">Reddit</a>
      </div>
      <button id="nxShareClose" style="margin-top:14px;background:none;border:none;color:#a7abc9;cursor:pointer;font:inherit">Close</button>
    </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#nxShareClose').onclick = close;
    const copy = wrap.querySelector('#nxShareCopy');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(text + ' ' + link); copy.textContent = 'Copied!'; }
      catch (e) { wrap.querySelector('#nxShareLink').select(); }
    };
    const nat = wrap.querySelector('#nxShareNative');
    if (!navigator.share) nat.style.display = 'none';
    nat.onclick = () => navigator.share({ title: 'Play Nexus', text, url: link }).catch(() => {});
  }
};
