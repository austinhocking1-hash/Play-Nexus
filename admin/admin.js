// Play Nexus Admin Panel — talks to the real Flask API in server/.
// Auth is a real session cookie; games/shop/challenges/leaderboard are
// read from and written to server/playnexus.db via server/app.py.

const API = window.PLAY_NEXUS_API_BASE || '';

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

// ---------- Login gate (real session-based auth) ----------
const loginScreen = document.getElementById('loginScreen');
const adminLayout = document.getElementById('adminLayout');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginError = document.getElementById('loginError');

function showAdmin() {
  loginScreen.style.display = 'none';
  adminLayout.style.display = 'flex';
  renderAll();
}

function showLogin(errorMsg) {
  loginScreen.style.display = 'flex';
  adminLayout.style.display = 'none';
  if (errorMsg) {
    loginError.textContent = errorMsg;
    loginError.style.display = 'block';
  } else {
    loginError.style.display = 'none';
  }
}

loginBtn.addEventListener('click', async () => {
  const username = document.getElementById('userInput').value.trim();
  const password = document.getElementById('passInput').value;
  loginBtn.disabled = true;
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (user.role !== 'admin') {
      await api('/api/auth/logout', { method: 'POST' });
      showLogin('This account does not have admin access.');
      return;
    }
    showAdmin();
  } catch (e) {
    showLogin(e.message);
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

(async function checkSession() {
  try {
    const { user } = await api('/api/auth/me');
    if (user && user.role === 'admin') {
      showAdmin();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();

// ---------- Nav switching ----------
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
  });
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function showFormError(form, message) {
  let el = form.querySelector('.form-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'form-error';
    el.style.color = '#ff5c5c';
    el.style.fontSize = '0.82rem';
    el.style.marginTop = '-6px';
    el.style.marginBottom = '10px';
    form.insertBefore(el, form.querySelector('.form-actions'));
  }
  el.textContent = message;
}

function clearFormError(form) {
  const el = form.querySelector('.form-error');
  if (el) el.remove();
}

// ---------- Generic CRUD wiring for games / shop / challenges ----------
function setupCrud({ resource, tableBodyId, formId, addBtnId, saveBtnId, cancelBtnId, fields, renderRow, onCreate }) {
  const tableBody = document.getElementById(tableBodyId);
  const form = document.getElementById(formId);
  const addBtn = document.getElementById(addBtnId);
  const saveBtn = document.getElementById(saveBtnId);
  const cancelBtn = document.getElementById(cancelBtnId);
  let editingId = null;

  async function render() {
    const { items } = await api(`/api/${resource}`);
    tableBody.innerHTML = items.map(renderRow).join('');
    tableBody.querySelectorAll('[data-edit]').forEach(el => {
      el.addEventListener('click', () => openForEdit(Number(el.dataset.edit), items));
    });
    tableBody.querySelectorAll('[data-delete]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('Delete this entry?')) return;
        await api(`/api/${resource}/${el.dataset.delete}`, { method: 'DELETE' });
        await render();
        updateStats();
      });
    });
    return items;
  }

  function openForCreate() {
    editingId = null;
    clearFormError(form);
    fields.forEach(f => document.getElementById(f.id).value = f.default || '');
    form.classList.add('active');
  }

  function openForEdit(id, items) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    editingId = id;
    clearFormError(form);
    fields.forEach(f => document.getElementById(f.id).value = item[f.prop]);
    form.classList.add('active');
  }

  function closeForm() {
    form.classList.remove('active');
    editingId = null;
  }

  addBtn.addEventListener('click', openForCreate);
  cancelBtn.addEventListener('click', closeForm);

  saveBtn.addEventListener('click', async () => {
    const values = {};
    for (const f of fields) {
      const raw = document.getElementById(f.id).value;
      values[f.prop] = f.number ? Number(raw) || 0 : raw.trim();
    }
    try {
      if (editingId) {
        await api(`/api/${resource}/${editingId}`, { method: 'PUT', body: JSON.stringify(values) });
        closeForm();
      } else {
        const res = await api(`/api/${resource}`, { method: 'POST', body: JSON.stringify(values) });
        closeForm();
        if (onCreate) onCreate(res);
      }
      await render();
      updateStats();
    } catch (e) {
      showFormError(form, e.message);
    }
  });

  render();
  return render;
}

function showGenStatus(html, kind) {
  const el = document.getElementById('gameGenStatus');
  el.innerHTML = `<div class="gen-status ${kind}">${html}</div>`;
}

function genErrorHtml(message, traceback) {
  let html = `⚠️ Generation failed: ${escapeHtml(message)}`;
  if (traceback) {
    html += `<details style="margin-top:8px;"><summary style="cursor:pointer;">Show technical details</summary><pre style="white-space:pre-wrap; font-size:0.75rem; margin-top:8px;">${escapeHtml(traceback)}</pre></details>`;
  }
  return html;
}

function setupGames() {
  const rerender = setupCrud({
    resource: 'games',
    tableBodyId: 'gamesTableBody',
    formId: 'gameForm',
    addBtnId: 'addGameBtn',
    saveBtnId: 'saveGameBtn',
    cancelBtnId: 'cancelGameBtn',
    fields: [
      { id: 'gameTitle', prop: 'title' },
      { id: 'gameGenre', prop: 'genre' },
      { id: 'gameStatus', prop: 'status' },
    ],
    renderRow: g => `
      <tr>
        <td>${escapeHtml(g.title)}</td>
        <td>${escapeHtml(g.genre)}</td>
        <td><span class="badge">${escapeHtml(g.status)}</span></td>
        <td class="row-actions">
          <a class="icon-btn" href="/games/${encodeURIComponent(g.slug)}.html" target="_blank" rel="noopener">Play</a>
          <button class="icon-btn" data-regen="${g.id}" data-slug="${escapeHtml(g.slug)}">🤖 Regenerate</button>
          <button class="icon-btn" data-edit="${g.id}">Edit</button>
          <button class="icon-btn danger" data-delete="${g.id}">Delete</button>
        </td>
      </tr>`,
    onCreate: (res) => {
      const gen = res.generation;
      if (!gen) return;
      if (gen.ok) {
        showGenStatus(
          `✅ AI generated <b>${escapeHtml(res.item.title)}</b> and pushed it to GitHub. ` +
          `<a href="/games/${encodeURIComponent(res.item.slug)}.html" target="_blank" rel="noopener">Play it</a> ` +
          `(may take a minute to go live if this triggers a redeploy).`,
          'ok'
        );
      } else {
        showGenStatus(genErrorHtml(gen.message, gen.traceback), 'error');
      }
    },
  });

  document.getElementById('gamesTableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-regen]');
    if (!btn) return;
    const id = btn.dataset.regen;
    const slug = btn.dataset.slug;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    showGenStatus('🤖 Asking Claude to generate this game… this can take up to a minute.', 'pending');
    try {
      const { generation } = await api(`/api/games/${id}/generate`, { method: 'POST' });
      if (generation.ok) {
        showGenStatus(
          `✅ Regenerated and pushed to GitHub. <a href="/games/${encodeURIComponent(slug)}.html" target="_blank" rel="noopener">Play it</a>`,
          'ok'
        );
      } else {
        showGenStatus(genErrorHtml(generation.message, generation.traceback), 'error');
      }
    } catch (err) {
      const gen = err.data && err.data.generation;
      showGenStatus(genErrorHtml(err.message, gen && gen.traceback), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🤖 Regenerate';
    }
  });

  return rerender;
}

function setupShop() {
  return setupCrud({
    resource: 'shop',
    tableBodyId: 'shopTableBody',
    formId: 'shopForm',
    addBtnId: 'addShopBtn',
    saveBtnId: 'saveShopBtn',
    cancelBtnId: 'cancelShopBtn',
    fields: [
      { id: 'shopName', prop: 'name' },
      { id: 'shopCategory', prop: 'category' },
      { id: 'shopPrice', prop: 'price', number: true },
    ],
    renderRow: s => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.category)}</td>
        <td>🪙 ${Number(s.price).toLocaleString()}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit="${s.id}">Edit</button>
          <button class="icon-btn danger" data-delete="${s.id}">Delete</button>
        </td>
      </tr>`,
  });
}

function setupChallenges() {
  return setupCrud({
    resource: 'challenges',
    tableBodyId: 'challengesTableBody',
    formId: 'challengeForm',
    addBtnId: 'addChallengeBtn',
    saveBtnId: 'saveChallengeBtn',
    cancelBtnId: 'cancelChallengeBtn',
    fields: [
      { id: 'challengeName', prop: 'name' },
      { id: 'challengeType', prop: 'type' },
      { id: 'challengeReward', prop: 'reward' },
    ],
    renderRow: c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td><span class="badge">${escapeHtml(c.type)}</span></td>
        <td>${escapeHtml(c.reward)}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit="${c.id}">Edit</button>
          <button class="icon-btn danger" data-delete="${c.id}">Delete</button>
        </td>
      </tr>`,
  });
}

// ---------- Leaderboard (separate: ranked by score, own fields) ----------
async function renderLeaderboardTable() {
  const tableBody = document.getElementById('leaderboardTableBody');
  const { items } = await api('/api/leaderboard');
  const sorted = items.slice().sort((a, b) => b.score - a.score);
  tableBody.innerHTML = sorted.map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(e.player_name)}</td>
      <td>${escapeHtml(e.game)}</td>
      <td>${Number(e.score).toLocaleString()}</td>
      <td class="row-actions">
        <button class="icon-btn" data-edit="${e.id}">Edit</button>
        <button class="icon-btn danger" data-delete="${e.id}">Delete</button>
      </td>
    </tr>`).join('');

  tableBody.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const item = items.find(i => i.id === Number(el.dataset.edit));
      if (!item) return;
      document.getElementById('scorePlayer').value = item.player_name;
      document.getElementById('scoreGame').value = item.game;
      document.getElementById('scoreValue').value = item.score;
      const form = document.getElementById('scoreForm');
      clearFormError(form);
      form.classList.add('active');
      form.dataset.editingId = item.id;
    });
  });
  tableBody.querySelectorAll('[data-delete]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      await api(`/api/leaderboard/${el.dataset.delete}`, { method: 'DELETE' });
      renderLeaderboardTable();
    });
  });
}

function setupLeaderboard() {
  const scoreForm = document.getElementById('scoreForm');
  document.getElementById('addScoreBtn').addEventListener('click', () => {
    scoreForm.dataset.editingId = '';
    clearFormError(scoreForm);
    document.getElementById('scorePlayer').value = '';
    document.getElementById('scoreGame').value = '';
    document.getElementById('scoreValue').value = '';
    scoreForm.classList.add('active');
  });
  document.getElementById('cancelScoreBtn').addEventListener('click', () => {
    scoreForm.classList.remove('active');
  });
  document.getElementById('saveScoreBtn').addEventListener('click', async () => {
    const values = {
      player_name: document.getElementById('scorePlayer').value.trim(),
      game: document.getElementById('scoreGame').value.trim(),
      score: Number(document.getElementById('scoreValue').value) || 0,
    };
    const editingId = Number(scoreForm.dataset.editingId);
    try {
      if (editingId) {
        await api(`/api/leaderboard/${editingId}`, { method: 'PUT', body: JSON.stringify(values) });
      } else {
        await api('/api/leaderboard', { method: 'POST', body: JSON.stringify(values) });
      }
      scoreForm.classList.remove('active');
      renderLeaderboardTable();
    } catch (e) {
      showFormError(scoreForm, e.message);
    }
  });
  renderLeaderboardTable();
}

async function updateStats() {
  const [games, shop, challenges, stats] = await Promise.all([
    api('/api/games'),
    api('/api/shop'),
    api('/api/challenges'),
    api('/api/admin/stats'),
  ]);
  document.getElementById('statGames').textContent = games.items.length;
  document.getElementById('statShop').textContent = shop.items.length;
  document.getElementById('statChallenges').textContent = challenges.items.length;
  document.getElementById('statPlayers').textContent = stats.players;
}

async function checkHealth() {
  const dot = document.querySelector('#statusPill .status-dot');
  const text = document.getElementById('statusText');
  try {
    await api('/api/health');
    dot.style.background = '#1fae5a';
    text.textContent = 'SERVER ONLINE';
    document.getElementById('statusPill').style.background = '#e7f9ee';
    document.getElementById('statusPill').style.color = '#1fae5a';
  } catch {
    document.getElementById('statusPill').style.background = '#fde8ea';
    document.getElementById('statusPill').style.color = '#e0293f';
    dot.style.background = '#e0293f';
    text.textContent = 'SERVER OFFLINE';
  }
}

let initialized = false;
function renderAll() {
  checkHealth();
  if (initialized) {
    updateStats();
    return;
  }
  initialized = true;
  setupGames();
  setupShop();
  setupChallenges();
  setupLeaderboard();
  updateStats();
}
