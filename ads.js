// Ad slots. Set window.PLAY_NEXUS_ADS = { client: 'ca-pub-XXXX', slot: 'YYYY' } in config.js
// to serve Google AdSense ads. Until then, house ads promote Play Nexus itself.
(function () {
  const cfg = window.PLAY_NEXUS_ADS || {};
  const base = location.pathname.includes('/games/') ? '../' : '/';
  const house = [
    { t: '🏆 Win the weekly prize', d: 'Get the #1 score on this week\'s game.', href: base + (base === '/' ? '#weekly' : 'index.html#weekly') },
    { t: '🎯 Daily Challenge', d: 'Beat today\'s target for bonus NexBucks.', href: base + (base === '/' ? '#games' : 'index.html#games') },
    { t: '💡 Got an idea?', d: 'Suggest a game or report a bug.', href: '/suggestions' },
  ];
  function render(slot) {
    slot.style.cssText = 'max-width:728px;margin:16px auto;text-align:center;min-height:60px';
    if (cfg.client && cfg.slot) {
      slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${cfg.client}" data-ad-slot="${cfg.slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
      return;
    }
    const h = house[Math.floor(Math.random() * house.length)];
    slot.innerHTML = `<a href="${h.href}" style="display:block;padding:14px 18px;border:1px dashed #7c5cff;border-radius:12px;color:inherit;text-decoration:none;background:rgba(124,92,255,.08)">
      <small style="opacity:.6;float:right">Ad</small><b>${h.t}</b><br><span style="opacity:.8">${h.d}</span></a>`;
  }
  function init() {
    if (cfg.client && cfg.slot) {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + cfg.client;
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
    }
    document.querySelectorAll('.ad-slot').forEach(render);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
