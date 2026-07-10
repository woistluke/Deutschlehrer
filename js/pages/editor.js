// pages/editor.js — the freeform curriculum editor. Everything (sections,
// units, vocab) can be added, edited, reordered, or removed.
import * as store from '../store.js';

let CTX, ROOT, expanded = new Set();

export async function mountEditor(el, ctx) {
  CTX = ctx; ROOT = el;
  await render();
}

async function render() {
  const sections = await store.getCurriculum(CTX.userId);
  ROOT.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Curriculum</div>
      <h1>Curriculum editor</h1>
      <p>Reorder, rename, add, or remove anything. Sections and units are fully freeform — the starting layout was only a proposal.</p>
    </div>
    <div class="row spread" style="margin-bottom:16px">
      <span class="muted">${sections.length} sections · ${sections.reduce((n, s) => n + s.units.length, 0)} units</span>
      <button class="btn primary" id="add-section">+ Add section</button>
    </div>
    <div id="spine"></div>
  `;
  ROOT.querySelector('#add-section').onclick = addSection;
  const spine = ROOT.querySelector('#spine');
  if (!sections.length) {
    spine.innerHTML = `<div class="empty"><h3>No curriculum yet</h3><p>Add a section to begin, or reset the seed from Settings.</p></div>`;
    return;
  }
  sections.forEach((sec, si) => spine.appendChild(sectionEl(sec, si, sections.length)));
}

function sectionEl(sec, si, total) {
  const wrap = document.createElement('div');
  wrap.className = 'spine-section';
  wrap.innerHTML = `
    <header>
      <span class="spine-tick"></span>
      <span class="spine-title" data-edit="section-title">${escapeHtml(sec.title)}</span>
      <span class="muted" style="font-size:.8rem">${sec.units.length} units</span>
      <span style="margin-left:auto" class="row">
        <button class="btn ghost sm" data-act="up" ${si === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn ghost sm" data-act="down" ${si === total - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn ghost sm" data-act="rename">Rename</button>
        <button class="btn ghost sm" data-act="add-unit">+ Unit</button>
        <button class="btn danger sm" data-act="del">Delete</button>
      </span>
    </header>
    <div class="spine-rail"></div>
  `;
  const rail = wrap.querySelector('.spine-rail');
  sec.units.forEach((u, ui) => rail.appendChild(unitEl(u, sec, ui)));

  wrap.querySelector('[data-act="up"]').onclick = () => moveSection(sec, -1);
  wrap.querySelector('[data-act="down"]').onclick = () => moveSection(sec, +1);
  wrap.querySelector('[data-act="rename"]').onclick = async () => {
    const t = prompt('Section title:', sec.title); if (t) { await store.updateSection(sec.section_id, { title: t }); render(); }
  };
  wrap.querySelector('[data-act="add-unit"]').onclick = async () => {
    const t = prompt('New unit title:'); if (!t) return;
    await store.createUnit(CTX.userId, { section_id: sec.section_id, title: t, position: sec.units.length, status: 'available' });
    render();
  };
  wrap.querySelector('[data-act="del"]').onclick = async () => {
    if (confirm(`Delete section "${sec.title}" and its ${sec.units.length} units?`)) { await store.deleteSection(sec.section_id); render(); }
  };
  return wrap;
}

function unitEl(u, sec, ui) {
  const d = document.createElement('div');
  d.className = `unit ${u.status}`;
  const open = expanded.has(u.unit_id);
  d.innerHTML = `
    <div class="row spread">
      <div>
        <span class="unit-title">${escapeHtml(u.title)}</span>
        ${u.source ? `<span class="tag src-${u.source}" style="margin-left:8px">${u.source}</span>` : ''}
        <div class="unit-meta">${(u.objectives || []).join(' · ') || 'no objectives set'}</div>
      </div>
      <button class="btn ghost sm" data-act="toggle">${open ? 'Close' : 'Edit'}</button>
    </div>
    ${open ? unitEditor(u) : ''}
  `;
  d.querySelector('[data-act="toggle"]').onclick = () => { open ? expanded.delete(u.unit_id) : expanded.add(u.unit_id); render(); };
  if (open) wireUnitEditor(d, u, sec, ui);
  return d;
}

function unitEditor(u) {
  return `
    <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
      <div class="grid2">
        <label class="field"><span>Title</span><input data-f="title" value="${attr(u.title)}"></label>
        <label class="field"><span>Source <small>(CBG / Duolingo / PaulNoble / blank)</small></span><input data-f="source" value="${attr(u.source || '')}"></label>
        <label class="field"><span>Objectives <small>(comma-separated)</small></span><input data-f="objectives" value="${attr((u.objectives || []).join(', '))}"></label>
        <label class="field"><span>Grammar focus <small>(comma-separated)</small></span><input data-f="grammar" value="${attr((u.grammar_focus || []).join(', '))}"></label>
        <label class="field"><span>Mastery threshold</span><input data-f="threshold" type="number" step="0.05" min="0" max="1" value="${u.mastery_threshold ?? 0.8}"></label>
        <label class="field"><span>Status</span>
          <select data-f="status">
            ${['locked', 'available', 'in_progress', 'complete'].map((s) => `<option ${u.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></label>
      </div>

      <h3 style="margin:8px 0">Vocabulary</h3>
      <div data-vocab-list>
        ${(u.vocab || []).map((v) => vocabRow(v)).join('') || '<p class="muted">No vocab yet.</p>'}
      </div>
      <div class="row" style="margin-top:8px">
        <input data-nv="german" placeholder="German" style="flex:1">
        <input data-nv="english" placeholder="English" style="flex:1">
        <input data-nv="notes" placeholder="note (optional)" style="flex:1.4">
        <button class="btn sm" data-act="add-vocab">Add</button>
      </div>

      <div class="row wrap" style="margin-top:16px;gap:8px">
        <button class="btn primary sm" data-act="save-unit">Save unit</button>
        <button class="btn ghost sm" data-act="u-up">↑ Move up</button>
        <button class="btn ghost sm" data-act="u-down">↓ Move down</button>
        <button class="btn danger sm" data-act="del-unit">Delete unit</button>
      </div>
    </div>
  `;
}

function vocabRow(v) {
  return `<div class="row" data-vid="${v.vocab_id}" style="margin-bottom:6px">
    <input data-vf="german" value="${attr(v.german)}" style="flex:1">
    <input data-vf="english" value="${attr(v.english)}" style="flex:1">
    <input data-vf="notes" value="${attr(v.notes || '')}" placeholder="note" style="flex:1.4">
    <button class="btn danger sm" data-act="del-vocab">×</button>
  </div>`;
}

function wireUnitEditor(d, u, sec, ui) {
  const f = (name) => d.querySelector(`[data-f="${name}"]`);
  d.querySelector('[data-act="save-unit"]').onclick = async () => {
    // mastery_threshold is compared directly against mastery_score, which
    // maxes out at 1.0 (see srs.js) — the <input min/max are only browser
    // hints, not enforcement, so a stray typo (e.g. "8" instead of "0.8")
    // would otherwise save verbatim and make this unit's completion
    // permanently unreachable with no indication why. Clamp instead.
    const rawThreshold = parseFloat(f('threshold').value);
    const threshold = Number.isFinite(rawThreshold) ? Math.min(1, Math.max(0, rawThreshold)) : 0.8;
    if (!Number.isFinite(rawThreshold) || rawThreshold < 0 || rawThreshold > 1) {
      alert(`Mastery threshold must be between 0 and 1. Using ${threshold} instead of "${f('threshold').value}".`);
    }
    await store.updateUnit(u.unit_id, {
      title: f('title').value.trim(),
      source: f('source').value.trim() || null,
      objectives: splitList(f('objectives').value),
      grammar_focus: splitList(f('grammar').value),
      mastery_threshold: threshold,
      status: f('status').value,
    });
    render();
  };
  d.querySelector('[data-act="del-unit"]').onclick = async () => {
    if (confirm(`Delete unit "${u.title}"?`)) { expanded.delete(u.unit_id); await store.deleteUnit(u.unit_id); render(); }
  };
  d.querySelector('[data-act="u-up"]').onclick = () => moveUnit(u, sec, ui, -1);
  d.querySelector('[data-act="u-down"]').onclick = () => moveUnit(u, sec, ui, +1);

  d.querySelector('[data-act="add-vocab"]').onclick = async () => {
    const g = d.querySelector('[data-nv="german"]').value.trim();
    const e = d.querySelector('[data-nv="english"]').value.trim();
    if (!g || !e) return;
    await store.createVocab(CTX.userId, { unit_id: u.unit_id, german: g, english: e, notes: d.querySelector('[data-nv="notes"]').value.trim() });
    render();
  };
  d.querySelectorAll('[data-vid]').forEach((rowEl) => {
    const vid = rowEl.getAttribute('data-vid');
    rowEl.querySelector('[data-act="del-vocab"]').onclick = async () => { await store.deleteVocab(vid); render(); };
    rowEl.querySelectorAll('[data-vf]').forEach((inp) => {
      inp.onblur = async () => {
        await store.updateVocab(vid, {
          german: rowEl.querySelector('[data-vf="german"]').value.trim(),
          english: rowEl.querySelector('[data-vf="english"]').value.trim(),
          notes: rowEl.querySelector('[data-vf="notes"]').value.trim() || null,
        });
      };
    });
  });
}

// ---- reordering (swap positions) ----
async function moveSection(sec, dir) {
  const sections = await store.getCurriculum(CTX.userId);
  const i = sections.findIndex((s) => s.section_id === sec.section_id);
  const j = i + dir; if (j < 0 || j >= sections.length) return;
  await store.updateSection(sections[i].section_id, { position: j });
  await store.updateSection(sections[j].section_id, { position: i });
  render();
}
async function moveUnit(u, sec, ui, dir) {
  const j = ui + dir; if (j < 0 || j >= sec.units.length) return;
  await store.updateUnit(sec.units[ui].unit_id, { position: j });
  await store.updateUnit(sec.units[j].unit_id, { position: ui });
  render();
}
async function addSection() {
  const sections = await store.getCurriculum(CTX.userId);
  const t = prompt('New section title:'); if (!t) return;
  await store.createSection(CTX.userId, { title: t, position: sections.length });
  render();
}

// ---- utils ----
function splitList(s) { return s.split(',').map((x) => x.trim()).filter(Boolean); }
function escapeHtml(s) { return (s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function attr(s) { return (s ?? '').toString().replace(/"/g, '&quot;'); }
