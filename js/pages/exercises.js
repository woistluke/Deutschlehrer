// pages/exercises.js — "Exercises": standalone practice games, separate from
// the Today runner's curriculum-paced four-phase lessons. A simple catalog
// of selectable cards; each exercise is its own module under js/exercises/
// exporting { meta: {id, title, blurb}, mount(el, ctx) }. Adding a new
// exercise later is just a new module + one line in CATALOG below.
import * as freeConversation from '../exercises/freeConversation.js';
import * as conjugationMatch from '../exercises/conjugationMatch.js';

const CATALOG = [freeConversation, conjugationMatch];

export async function mountExercises(el, ctx) {
  // Tracks whichever standalone exercise is currently mounted inside this
  // same page (e.g. Free Conversation), so this page's own unmount hook can
  // close it out properly — see the comment below and app.js's navigate().
  let activeUnmount = null;

  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Practice</div>
      <h1>Exercises</h1>
      <p>Standalone practice games, separate from today's lesson — pick one below. More will show up here over time.</p>
    </div>
    <div class="ex-grid">
      ${CATALOG.map((ex) => `
        <button class="card ex-card" data-ex="${esc(ex.meta.id)}">
          <h3 style="margin:0 0 6px">${esc(ex.meta.title)}</h3>
          <p class="muted" style="margin:0;font-size:.86rem">${esc(ex.meta.blurb)}</p>
        </button>
      `).join('')}
    </div>
  `;
  el.querySelectorAll('[data-ex]').forEach((b) => {
    b.onclick = () => {
      const ex = CATALOG.find((x) => x.meta.id === b.dataset.ex);
      if (!ex) return;
      activeUnmount = null;
      // ex.mount() swaps this same `el`'s content directly (not through
      // app.js's navigate() — that's only for the top-level nav tabs), and
      // may be sync (Free Conversation) or async (Verb Conjugation Match).
      // Normalize to a promise so either shape is handled the same way, and
      // capture whatever cleanup function it returns, if any.
      Promise.resolve(ex.mount(el, ctx)).then((cleanup) => {
        activeUnmount = typeof cleanup === 'function' ? cleanup : null;
      });
    };
  });

  // Unmount hook consumed by app.js's navigate(): leaving the Exercises tab
  // entirely (top nav) while a sub-exercise like Free Conversation is active
  // previously skipped that exercise's own cleanup, since ex.mount() isn't
  // reached through navigate() and app.js only ever saw mountExercises'
  // return value (previously nothing). See IMPROVEMENT_LOG.md 2026-07-16
  // item 3.
  return () => (activeUnmount ? activeUnmount() : undefined);
}

function esc(s) { return (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
