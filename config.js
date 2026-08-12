// Where the Play Nexus backend API lives.
//
// - If the frontend and backend are served from the SAME domain (e.g. both
//   deployed together on Render), leave this as ''.
// - If the frontend is on Netlify and the backend is a separate Render
//   service (cross-origin), set this to that backend's full URL, e.g.
//   'https://play-nexus.onrender.com' (no trailing slash).
window.PLAY_NEXUS_API_BASE = 'https://play-nexus.onrender.com';
