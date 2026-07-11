// pages/exercises.js — "Exercises": standalone practice games, separate from
// the Today runner's curriculum-paced four-phase lessons. A simple catalog
// of selectable cards; each exercise is its own module under js/exercises/
// exporting { meta: {id, title, blurb}, mount(el, ctx) }. Adding a new
// exercise later is just a new module + one line in CATALOG below.
import * as conjugationMatch from '../exercises/conjugationMatch.js';

const CATALOG = [conjugationMatch];

export async function mountExercises(el, ctx) {
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
      if (ex) ex.mount(el, ctx);
    };
  });
}

function esc(s) { return (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
