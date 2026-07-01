// pages/stats.js — user-specific statistics. Sessions, completion, current
// progress, an estimated CEFR level per skill, and a few motivating extras.
import * as store from '../store.js';
import { estimateLevels, readinessToward } from '../cefr.js';

export async function mountStats(el, ctx) {
  el.innerHTML = `<div class="page-head"><div class="eyebrow">Progress</div><h1>Statistics</h1><p>Everything here is for <b>${esc(ctx.userId)}</b>, drawn from your sessions and quiz results.</p></div><p class="muted">Crunching the numbers…</p>`;

  const [sections, progress, sessions] = await Promise.all([
    store.getCurriculum(ctx.userId),
    store.allProgress(ctx.userId),
    store.allSessions(ctx.userId),
  ]);

  // ---- core counts ----
  const units = sections.flatMap((s) => s.units);
  const unitsTotal = units.length;
  const unitsComplete = units.filter((u) => u.status === 'complete').length;
  const sectionsTotal = sections.length;
  const sectionsComplete = sections.filter((s) => s.units.length && s.units.every((u) => u.status === 'complete')).length;
  const vocabTotal = units.reduce((n, u) => n + (u.vocab || []).length, 0);

  const masteredVocab = progress.filter((p) => p.item_type === 'vocab' && (p.mastery_score || 0) >= 0.8).length;
  const seen = progress.reduce((n, p) => n + (p.times_seen || 0), 0);
  const correct = progress.reduce((n, p) => n + (p.times_correct || 0), 0);
  const accuracy = seen ? correct / seen : 0;
  const dueNow = progress.filter((p) => !p.next_due || new Date(p.next_due) <= new Date()).length;

  const sessionCount = sessions.length;
  const conversationSessions = sessions.filter((s) => s.mode !== 'review').length;
  const streak = dayStreak(sessions);
  const active = units.find((u) => u.status !== 'complete');

  // ---- CEFR estimate ----
  const levels = estimateLevels({ masteredVocab, unitsComplete, unitsTotal, accuracy, conversationSessions });
  const hpReadiness = readinessToward(levels.overall.score, 'B1');

  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Progress</div>
      <h1>Statistics</h1>
      <p>Everything here is for <b>${esc(ctx.userId)}</b>, drawn from your sessions and quiz results.</p>
    </div>

    <div class="card">
      <div class="grid2" style="grid-template-columns:repeat(4,1fr)">
        ${stat(sessionCount, 'Sessions')}
        ${stat(`${unitsComplete}/${unitsTotal}`, 'Units done')}
        ${stat(`${sectionsComplete}/${sectionsTotal}`, 'Sections done')}
        ${stat(`${Math.round(accuracy * 100)}%`, 'Accuracy')}
      </div>
    </div>

    <div class="card">
      <h2>Estimated level</h2>
      <p class="muted" style="margin-top:0;font-size:.85rem">A rough gauge from your activity — vocabulary mastered, units completed, and quiz accuracy. Not a substitute for a real placement test.</p>
      ${skillRow('Reading', levels.reading)}
      ${skillRow('Listening', levels.listening)}
      ${skillRow('Speaking', levels.speaking)}
      <div style="border-top:1px solid var(--line);margin:14px 0 10px"></div>
      ${skillRow('Overall', levels.overall, true)}
    </div>

    <div class="card">
      <h2>Reading readiness — Harry Potter 🪄</h2>
      <p class="muted" style="margin-top:0;font-size:.85rem">Parallel German/English reading gets comfortable around B1. Here's how close the estimate puts you.</p>
      ${bar(hpReadiness, hpReadiness >= 100 ? 'Ready to start — viel Glück!' : `${Math.round(hpReadiness)}% of the way to B1`)}
    </div>

    <div class="card">
      <h2>Vocabulary</h2>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr)">
        ${stat(masteredVocab, 'Mastered')}
        ${stat(vocabTotal, 'In curriculum')}
        ${stat(dueNow, 'Due for review')}
      </div>
      ${bar(vocabTotal ? (masteredVocab / vocabTotal) * 100 : 0, `${masteredVocab} of ${vocabTotal} curriculum words mastered`)}
    </div>

    <div class="card">
      <h2>Habit</h2>
      <div class="grid2" style="grid-template-columns:repeat(3,1fr)">
        ${stat(`${streak}🔥`, streak === 1 ? 'Day streak' : 'Day streak')}
        ${stat(conversationSessions, 'Conversations')}
        ${stat(sessionCount - conversationSessions, 'Review runs')}
      </div>
      <p class="muted" style="font-size:.85rem;margin-bottom:0">${active ? `Currently working on <b>${esc(active.title)}</b>.` : 'All units complete — add more in the editor or keep reviewing.'}</p>
    </div>

    ${sectionsBreakdown(sections, progress)}
  `;
}

// ---- helpers ----
function stat(value, label) {
  return `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
}
function bar(pct, caption) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="meter" style="margin:8px 0 4px"><span style="width:${p}%"></span></div>
          <div class="muted" style="font-size:.8rem">${caption}</div>`;
}
function skillRow(label, lvl, strong) {
  return `<div style="margin:10px 0">
    <div class="row spread" style="margin-bottom:4px">
      <span style="font-weight:${strong ? 700 : 600}">${label}</span>
      <span style="font-family:'Spectral',serif;font-size:1.05rem;color:var(--gold-deep)">${lvl.band}</span>
    </div>
    <div class="meter"><span style="width:${Math.round(lvl.within * 100)}%"></span></div>
  </div>`;
}
function sectionsBreakdown(sections, progress) {
  if (!sections.length) return '';
  const byUnit = {};
  progress.forEach((p) => { if (p.unit_id) (byUnit[p.unit_id] = byUnit[p.unit_id] || []).push(p); });
  const rows = sections.map((s) => {
    const items = s.units.flatMap((u) => byUnit[u.unit_id] || []);
    const m = items.length ? items.reduce((n, p) => n + (p.mastery_score || 0), 0) / items.length : 0;
    return `<div style="margin:10px 0">
      <div class="row spread" style="margin-bottom:4px"><span>${esc(s.title)}</span><span class="muted" style="font-size:.8rem">${Math.round(m * 100)}%</span></div>
      <div class="meter"><span style="width:${Math.round(m * 100)}%"></span></div>
    </div>`;
  }).join('');
  return `<div class="card"><h2>By section</h2><p class="muted" style="margin-top:0;font-size:.85rem">Average mastery of the items you've practiced in each section.</p>${rows}</div>`;
}

// Consecutive-day streak ending today or yesterday.
function dayStreak(sessions) {
  if (!sessions.length) return 0;
  const days = new Set(sessions.map((s) => new Date(s.started_at).toISOString().slice(0, 10)));
  let streak = 0;
  const d = new Date();
  // allow the streak to count if the most recent activity was today or yesterday
  const todayKey = d.toISOString().slice(0, 10);
  const y = new Date(d); y.setDate(y.getDate() - 1);
  if (!days.has(todayKey) && !days.has(y.toISOString().slice(0, 10))) return 0;
  if (!days.has(todayKey)) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function esc(s) { return (s ?? '').toString().replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
