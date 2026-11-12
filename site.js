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

let extrasFor = null;
function toast(html, ms = 6000) {
  let box = document.getElementById('toastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastBox';
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9000;display:grid;gap:8px;max-width:320px';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.style.cssText = 'background:#1e2142;color:#fff;border:1px solid #7c5cff;border-radius:12px;padding:12px 14px;box-shadow:0 8px 24px rgba(0,0,0,.4)';
  t.innerHTML = html;
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

async function showAccountExtras() {
  if (!currentUser || extrasFor === currentUser.id) return;
  extrasFor = currentUser.id;
  if (currentUser.unseen_win) {
    const [prize, game] = currentUser.unseen_win.split('|');
    if (window.NexusScore) NexusScore.confetti();
    toast(`&#127942; <b>You won the weekly prize!</b><br>${escapeHtml(prize)} (${escapeHtml(game || '')}). Check your NexBucks!`, 12000);
    api('/api/ack-win', { method: 'POST' }).catch(() => {});
  }
  try {
    const { items } = await api('/api/notifications');
    items.slice(0, 3).forEach(n => toast('&#128276; ' + escapeHtml(n.text)));
    if (items.length) api('/api/notifications/seen', { method: 'POST' }).catch(() => {});
  } catch (e) {}
}

function renderAccount() {
  renderDailyBanner();
  showAccountExtras();
  if (currentUser) {
    navAccount.innerHTML = `
      <a class="account-name" href="/profile" style="color:inherit;text-decoration:none" title="View your profile">${escapeHtml(currentUser.username)}</a>
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

// ---------- Daily reward ----------
function renderDailyBanner() {
  let b = document.getElementById('dailyBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'dailyBanner';
    b.style.cssText = 'text-align:center;padding:10px 16px;font-weight:600;background:linear-gradient(90deg,#7c5cff,#ff5c9e);color:#fff';
    document.body.insertBefore(b, document.body.firstChild);
  }
  if (!currentUser) {
    b.innerHTML = 'Sign in to claim free daily NexBucks and build a streak!';
  } else if (currentUser.can_claim) {
    b.innerHTML = `Daily reward ready: +${currentUser.next_reward} NexBucks <button class="btn btn-secondary" id="claimBtn" style="margin-left:12px;padding:6px 14px">Claim</button>`;
    document.getElementById('claimBtn').onclick = async () => {
      try {
        const d = await api('/api/rewards/daily', { method: 'POST' });
        currentUser.nexbucks = d.nexbucks;
        currentUser.streak = d.streak;
        currentUser.can_claim = false;
        currentUser.next_reward = Math.min(50 + 25 * d.streak, 250);
        renderAccount();
        (d.badges || []).forEach(x => toast(`${x.emoji} Badge unlocked: <b>${escapeHtml(x.name)}</b>`));
        b.textContent = `+${d.reward} NexBucks claimed! Streak: ${d.streak} day${d.streak > 1 ? 's' : ''}. Come back tomorrow for +${currentUser.next_reward}!`;
      } catch (e) { b.textContent = e.message; }
    };
  } else {
    b.textContent = `Streak: ${currentUser.streak} day${currentUser.streak > 1 ? 's' : ''}. Come back tomorrow for +${currentUser.next_reward} NexBucks!`;
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
let lbGame = null;
async function renderLeaderboard() {
  const body = document.getElementById('leaderboardBody');
  if (!body) return;
  try {
    const { items } = await api('/api/leaderboard');
    const games = [...new Set(items.map(e => e.game))].sort();
    let picker = document.getElementById('lbGamePicker');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'lbGamePicker';
      picker.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 16px';
      body.closest('table').parentNode.insertBefore(picker, body.closest('table'));
    }
    if (!lbGame || !games.includes(lbGame)) lbGame = games[0] || null;
    picker.innerHTML = games.map(g =>
      `<button class="btn ${g === lbGame ? 'btn-primary' : 'btn-secondary'}" data-lbgame="${escapeHtml(g)}" style="padding:6px 14px">${escapeHtml(g)}</button>`).join('');
    picker.querySelectorAll('[data-lbgame]').forEach(b => b.onclick = () => { lbGame = b.dataset.lbgame; renderLeaderboard(); });
    const sorted = items.filter(e => e.game === lbGame).sort((a, b) => b.score - a.score).slice(0, 10);
    body.innerHTML = sorted.map((e, i) => {
      const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
      return `
        <tr>
          <td><span class="rank ${rankClass}">${i + 1}</span></td>
          <td><a href="/profile?u=${encodeURIComponent(e.player_name)}" style="color:inherit">${escapeHtml(e.player_name)}</a></td>
          <td>${escapeHtml(e.game)}</td>
          <td>${Number(e.score).toLocaleString()}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="4" class="loading-note">No scores yet. Play a game and be the first!</td></tr>';
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


// ---------- Weekly prize ----------
(async function loadWeekly() {
  try {
    const { current, past } = await api('/api/weekly');
    const sec = document.getElementById('weekly');
    if (!current && !past.length) return;
    sec.style.display = '';
    const lede = document.getElementById('weeklyLede');
    const body = document.getElementById('weeklyBody');
    if (current) {
      lede.innerHTML = `This week: play <b>${escapeHtml(current.game)}</b>. The #1 score wins <b>${escapeHtml(current.prize)}</b>${current.bonus_nexbucks ? ` + ${current.bonus_nexbucks} NexBucks` : ''}!`;
      body.innerHTML = current.top.length
        ? current.top.map((r, i) => `<tr><td>${i + 1}</td><td><a href="/profile?u=${encodeURIComponent(r.player_name)}" style="color:inherit">${escapeHtml(r.player_name)}</a></td><td>${r.score.toLocaleString()}</td></tr>`).join('')
        : '<tr><td colspan="3">No scores yet. Be the first!</td></tr>';
    } else {
      lede.textContent = 'The next weekly prize is coming soon.';
      body.innerHTML = '';
    }
    document.getElementById('weeklyPast').innerHTML = past.length
      ? 'Past winners: ' + past.map(p => `${escapeHtml(p.winner_name)} (${escapeHtml(p.game)}, ${escapeHtml(p.prize)})`).join(' &middot; ')
      : '';
  } catch (e) {}
})();


// ---------- Daily challenge ----------
(async function loadDailyChallenge() {
  try {
    const ch = await api('/api/daily-challenge');
    const grid = document.getElementById('gameGrid');
    if (!grid) return;
    const card = document.createElement('div');
    card.style.cssText = 'margin:0 0 24px;padding:16px 20px;border-radius:14px;border:1px solid #7c5cff;background:linear-gradient(90deg,rgba(124,92,255,.18),rgba(255,92,158,.18));text-align:center';
    card.innerHTML = ch.done
      ? `&#127919; <b>Daily Challenge complete!</b> Come back tomorrow for a new one.`
      : `&#127919; <b>Daily Challenge:</b> score <b>${ch.target.toLocaleString()}</b>+ in <b>${escapeHtml(ch.game)}</b> for <b>+${ch.bonus} NexBucks</b>`;
    grid.parentNode.insertBefore(card, grid);
  } catch (e) {}
})();
