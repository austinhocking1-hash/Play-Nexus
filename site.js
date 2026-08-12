// Play Nexus front-end — talks to the real Flask API in server/.
// Games/shop/leaderboard are loaded live from server/playnexus.db, and
// signing in/up creates a real account with a real NexBucks balance.

const API_BASE = window.PLAY_NEXUS_API_BASE || '';

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let currentUser = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ---------- Auth panel ----------
const authPanel = document.getElementById('authPanel');
const authClose = document.getElementById('authClose');
const signInBtn = document.getElementById('signInBtn');
const navAccount = document.getElementById('navAccount');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');

function openAuthPanel(tab = 'login') {
  authPanel.classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  loginForm.classList.toggle('hidden', tab !== 'login');
  signupForm.classList.toggle('hidden', tab !== 'signup');
}

function closeAuthPanel() {
  authPanel.classList.add('hidden');
  document.getElementById('loginError').textContent = '';
  document.getElementById('signupError').textContent = '';
}

signInBtn?.addEventListener('click', () => openAuthPanel('login'));
authClose.addEventListener('click', closeAuthPanel);
authPanel.addEventListener('click', e => { if (e.target === authPanel) closeAuthPanel(); });

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => openAuthPanel(tab.dataset.tab));
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('loginId').value.trim(),
        password: document.getElementById('loginPassword').value,
      }),
    });
    currentUser = user;
    closeAuthPanel();
    renderAccount();
    renderShop();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

signupForm.addEventListener('submit', async e => {
  e.preventDefault();
  const errorEl = document.getElementById('signupError');
  errorEl.textContent = '';
  try {
    const { user } = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('signupUsername').value.trim(),
        email: document.getElementById('signupEmail').value.trim(),
        password: document.getElementById('signupPassword').value,
      }),
    });
    currentUser = user;
    closeAuthPanel();
    renderAccount();
    renderShop();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function renderAccount() {
  if (currentUser) {
    navAccount.innerHTML = `
      <span class="account-name">${escapeHtml(currentUser.username)}</span>
      <span class="account-balance">🪙 ${currentUser.nexbucks.toLocaleString()}</span>
      <button class="btn btn-secondary nav-cta" id="signOutBtn">Sign Out</button>
    `;
    document.getElementById('signOutBtn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      currentUser = null;
      renderAccount();
      renderShop();
    });
    const walletBalance = document.getElementById('walletBalance');
    if (walletBalance) walletBalance.textContent = `${currentUser.nexbucks.toLocaleString()} NexBucks`;
  } else {
    navAccount.innerHTML = `<button class="btn btn-secondary nav-cta" id="signInBtn">Sign In</button>`;
    document.getElementById('signInBtn').addEventListener('click', () => openAuthPanel('login'));
    const walletBalance = document.getElementById('walletBalance');
    if (walletBalance) walletBalance.textContent = 'Sign in to see balance';
  }
}

// ---------- Games ----------
async function renderGames() {
  const grid = document.getElementById('gameGrid');
  if (!grid) return;
  try {
    const { items } = await api('/api/games');
    const live = items.filter(g => g.status === 'Live');
    grid.innerHTML = live.map((g, i) => `
      <article class="game-card">
        <div class="game-thumb thumb-${(i % 4) + 1}"></div>
        <h3>${escapeHtml(g.title)}</h3>
        <p>${escapeHtml(g.genre)} game, live on Play Nexus.</p>
        <a href="games/${encodeURIComponent(g.slug)}.html" class="btn btn-small">Play</a>
      </article>`).join('') || '<p class="loading-note">No games listed yet.</p>';
  } catch {
    grid.innerHTML = '<p class="error-note">Could not load games. Is the server running?</p>';
  }
}

// ---------- Shop ----------
async function renderShop() {
  const grid = document.getElementById('shopGrid');
  if (!grid) return;
  try {
    const { items } = await api('/api/shop');
    grid.innerHTML = items.map((s, i) => `
      <article class="shop-card">
        <div class="shop-thumb thumb-${(i % 4) + 1}"></div>
        <span class="shop-tag">${escapeHtml(s.category)}</span>
        <h3>${escapeHtml(s.name)}</h3>
        <p>Redeemable with NexBucks earned from playing.</p>
        <div class="shop-footer">
          <span class="shop-price">🪙 ${Number(s.price).toLocaleString()}</span>
          <button class="btn btn-small" data-redeem="${s.id}">Redeem</button>
        </div>
      </article>`).join('');
    grid.querySelectorAll('[data-redeem]').forEach(btn => {
      btn.addEventListener('click', () => redeemItem(Number(btn.dataset.redeem), btn));
    });
  } catch {
    grid.innerHTML = '<p class="error-note">Could not load the shop. Is the server running?</p>';
  }
}

async function redeemItem(itemId, btn) {
  if (!currentUser) {
    openAuthPanel('login');
    return;
  }
  const originalText = btn.textContent;
  btn.textContent = 'Redeeming…';
  btn.disabled = true;
  try {
    const { nexbucks } = await api(`/api/shop/${itemId}/redeem`, { method: 'POST' });
    currentUser.nexbucks = nexbucks;
    renderAccount();
    btn.textContent = 'Redeemed!';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
  } catch (err) {
    alert(err.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ---------- Leaderboard ----------
async function renderLeaderboard() {
  const body = document.getElementById('leaderboardBody');
  if (!body) return;
  try {
    const { items } = await api('/api/leaderboard');
    const sorted = items.slice().sort((a, b) => b.score - a.score).slice(0, 10);
    body.innerHTML = sorted.map((e, i) => {
      const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
      return `
        <tr>
          <td><span class="rank ${rankClass}">${i + 1}</span></td>
          <td>${escapeHtml(e.player_name)}</td>
          <td>${escapeHtml(e.game)}</td>
          <td>${Number(e.score).toLocaleString()}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="4" class="loading-note">No scores yet.</td></tr>';
  } catch {
    body.innerHTML = '<tr><td colspan="4" class="error-note">Could not load the leaderboard. Is the server running?</td></tr>';
  }
}

// ---------- Init ----------
(async function init() {
  try {
    const { user } = await api('/api/auth/me');
    currentUser = user;
  } catch {
    currentUser = null;
  }
  renderAccount();
  renderGames();
  renderShop();
  renderLeaderboard();
})();
