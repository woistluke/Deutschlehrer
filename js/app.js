// app.js — shell, routing, and shared context.
import { LS, DEFAULTS } from './config.js';
import * as store from './store.js';
import { mountRunner } from './pages/runner.js';
import { mountEditor } from './pages/editor.js';
import { mountExercises } from './pages/exercises.js';
import { mountStats } from './pages/stats.js';
import { mountSettings } from './pages/settings.js';

// Free Conversation used to be its own tab here; it now lives in the
// Exercises catalog (js/exercises/freeConversation.js) alongside the other
// standalone practice games — see js/pages/exercises.js.
const PAGES = {
  runner:       { label: 'Today',        mount: mountRunner },
  exercises:    { label: 'Exercises',    mount: mountExercises },
  curriculum:   { label: 'Curriculum',   mount: mountEditor },
  stats:        { label: 'Stats',        mount: mountStats },
  settings:     { label: 'Settings',     mount: mountSettings },
};

let ctx = null;
let current = 'runner';

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS.settings)) || {}; } catch {}
  return { groqBase: DEFAULTS.groqBase, openaiBase: DEFAULTS.openaiBase, ...s };
}

async function boot() {
  const settings = loadSettings();
  const remote = store.initStore(settings);
  const userId = (localStorage.getItem(LS.activeUser) || 'luke').toLowerCase();

  await store.ensureUser(userId);
  // Seed the proposed curriculum on first run for this handle.
  if (!(await store.isSeeded(userId))) {
    await store.seedCurriculum(userId);
  }

  ctx = {
    userId, settings, remote,
    switchUser: async (u) => {
      localStorage.setItem(LS.activeUser, u);
      location.reload();
    },
    go: (page) => navigate(page),
    refresh: () => navigate(current),
  };

  renderShell();
  navigate('runner');
}

function renderShell() {
  document.body.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">Auf&nbsp;<span class="accent">Deutsch</span></div>
        <nav class="nav" id="nav">
          ${Object.entries(PAGES).map(([k, p]) => `<button data-page="${k}">${p.label}</button>`).join('')}
        </nav>
        <span class="user-pill">Handle: <b>${ctx.userId}</b>${ctx.remote ? '' : ' · local'}</span>
      </div>
    </header>
    <main class="page" id="view"></main>
  `;
  document.querySelectorAll('#nav button').forEach((b) =>
    b.onclick = () => navigate(b.dataset.page));
}

async function navigate(page) {
  current = page;
  document.querySelectorAll('#nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.page === page));
  const view = document.getElementById('view');
  view.innerHTML = '';
  await PAGES[page].mount(view, ctx);
}

boot().catch((e) => {
  document.body.innerHTML = `<main class="page"><div class="banner warn">Startup error: ${e.message}</div></main>`;
  console.error(e);
});
