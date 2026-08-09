// app.js — shell, routing, and shared context.
import { LS, DEFAULTS, VERSION } from './config.js';
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
// Cleanup returned by the currently-mounted page's mount() fn, if any (see
// navigate() below). Pages that open something worth closing out when the
// learner clicks away — a curriculum session, a Free Conversation session —
// return a cleanup function from mount(); pages with nothing to close out
// just return undefined, same as before this existed.
let currentUnmount = null;

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(LS.settings)) || {}; } catch {}
  return { groqBase: DEFAULTS.groqBase, openaiBase: DEFAULTS.openaiBase, ...s };
}

async function boot() {
  const settings = loadSettings();
  let remote = store.initStore(settings);
  const userId = (localStorage.getItem(LS.activeUser) || 'luke').toLowerCase();

  // A Supabase URL/key that's set but unreachable (typo, revoked key, a
  // paused free-tier project, network/CORS) previously threw here and hit
  // the top-level boot().catch() below, which wipes document.body down to a
  // bare "Startup error" banner with no nav — no way back into Settings to
  // fix or clear the bad credentials short of clearing localStorage by hand.
  // Fall back to local storage instead, same as the "no keys yet" path, so
  // the app stays usable and Settings shows what went wrong.
  let remoteError = null;
  try {
    await store.ensureUser(userId);
    if (!(await store.isSeeded(userId))) {
      await store.seedCurriculum(userId);
    }
  } catch (e) {
    console.error('Remote store unreachable, falling back to local storage:', e);
    remoteError = e;
    remote = store.initStore({});
    await store.ensureUser(userId);
    if (!(await store.isSeeded(userId))) {
      await store.seedCurriculum(userId);
    }
  }

  ctx = {
    userId, settings, remote, remoteError,
    switchUser: async (u) => {
      localStorage.setItem(LS.activeUser, u);
      location.reload();
    },
    go: (page) => navigate(page),
    refresh: () => navigate(current),
  };

  renderShell();
  navigate(remoteError ? 'settings' : 'runner');
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
        <span class="version-pill" title="Build version — tells you which build you're testing">v${VERSION}</span>
      </div>
    </header>
    <main class="page" id="view"></main>
  `;
  document.querySelectorAll('#nav button').forEach((b) =>
    b.onclick = () => navigate(b.dataset.page));
}

async function navigate(page) {
  // Give the outgoing page a chance to close out anything it opened (e.g. a
  // curriculum lesson or Free Conversation session row left "in_progress")
  // before its DOM is torn down. Previously navigate() just overwrote
  // view.innerHTML directly with no lifecycle hook at all, so clicking a
  // top-nav tab mid-lesson/mid-chat (rather than using the in-page "End
  // session"/"Change topic" button) silently abandoned that session row
  // forever — see IMPROVEMENT_LOG.md 2026-07-16 item 3.
  if (currentUnmount) {
    try { await currentUnmount(); } catch (e) { console.error('Page unmount cleanup failed:', e); }
    currentUnmount = null;
  }

  current = page;
  document.querySelectorAll('#nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.page === page));
  const view = document.getElementById('view');
  view.innerHTML = '';
  // mount() can throw (e.g. a transient Supabase hiccup on Stats/Curriculum/
  // Today's initial data fetch -- those don't defensively .catch() the way
  // a few specific spots elsewhere in the app do). Previously an uncaught
  // throw here just left view.innerHTML blank with nothing but a console
  // error and no way to recover short of a full reload -- only boot()'s
  // very first mount was ever guarded (see IMPROVEMENT_LOG.md 2026-07-18
  // item 2).
  try {
    currentUnmount = (await PAGES[page].mount(view, ctx)) || null;
  } catch (e) {
    console.error(`Failed to load page "${page}":`, e);
    currentUnmount = null;
    view.innerHTML = `<div class="page-head"><div class="eyebrow">${page}</div><h1>Something went wrong loading this page</h1></div>
      <div class="card"><p class="muted">${escapeErr(e.message || String(e))}</p><button class="btn primary" id="retry-page">Retry</button></div>`;
    const retry = view.querySelector('#retry-page');
    if (retry) retry.onclick = () => navigate(page);
  }
}

function escapeErr(s) {
  return (s ?? '').toString().replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

boot().catch((e) => {
  document.body.innerHTML = `<main class="page"><div class="banner warn">Startup error: ${e.message}</div></main>`;
  console.error(e);
});
