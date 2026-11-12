(function () {
  try {
    var id = '';
    try {
      id = localStorage.getItem('nx-vid');
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('nx-vid', id); }
    } catch (e) {}
    var base = window.PLAY_NEXUS_API_BASE || '';
    var body = JSON.stringify({ path: location.pathname.replace(/\.html$/, '') || '/', id: id });
    if (navigator.sendBeacon) navigator.sendBeacon(base + '/api/track', new Blob([body], { type: 'application/json' }));
    else fetch(base + '/api/track', { method: 'POST', body: body, keepalive: true });
  } catch (e) {}
})();
