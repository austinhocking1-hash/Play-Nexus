(function () {
  try {
    var base = window.PLAY_NEXUS_API_BASE || '';
    var body = JSON.stringify({ path: location.pathname.replace(/\.html$/, '') || '/' });
    if (navigator.sendBeacon) navigator.sendBeacon(base + '/api/track', new Blob([body], { type: 'application/json' }));
    else fetch(base + '/api/track', { method: 'POST', body: body, keepalive: true });
  } catch (e) {}
})();
