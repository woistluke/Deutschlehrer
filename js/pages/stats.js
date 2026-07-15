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

  // Listening-dictation accuracy (see recordListeningResult in runner.js) —
  // a distinct signal from overall accuracy, feeding cefr.js's Listening
  // skill instead of it reusing the blended reading/speaking figure.
  const listeningRows = progress.filter((p) => p.item_type === 'listening');
  const listeningReps = listeningRows.reduce((n, p) => n + (p.times_seen || 0), 0);
  const listeningCorrect = listeningRows.reduce((n, p) => n + (p.times_correct || 0), 0);
  const listeningAccuracy = listeningReps ? listeningCorrect / listeningReps : null;

  const sessionCount = sessions.length;
  // Previously one blended "Conversations" count (everything but review)
  // fed both the Stats "Conversations" stat AND cefr.js's speaking bonus —
  // so a learner who never opened Free Conversation still saw a
  // "Conversations" number built entirely from curriculum lessons (see
  // IMPROVEMENT_LOG.md 2026-07-14 item 3). Split by the sessions.mode values
  // the schema actually defines (curriculum | review | free) so the label
  // matches what's counted; cefr.js's speaking bonus deliberately still
  // combines lessonSessions + freeSessions (curriculum lessons have their
  // own conversation phase, so both are real speaking reps), just under an
  // honestly-named variable instead of an overloaded "conversations" one.
  const lessonSessions = sessions.filter((s) => s.mode === 'curriculum').length;
  const freeSessions = sessions.filter((s) => s.mode === 'free').length;
  const reviewSessions = sessions.filter((s) => s.mode === 'review').length;
  const speakingPracticeSessions = lessonSessions + freeSessions;
  const streak = dayStreak(sessions);
  const active = units.find((u) => u.status !== 'complete');

  // Recent sessions — what got introduced/reviewed and which error types came
  // up, per session (sessions.items_introduced/items_reviewed/errors_observed,
  // written by runner.js since 2026-07-11 but not surfaced anywhere until now —
  // see IMPROVEMENT_LOG.md 2026-07-14 item 2).
  const unitsById = Object.fromEntries(units.map((u) => [u.unit_id, u]));
  const recentSessionsList = [...sessions]
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, 8);

  // ---- CEFR estimate ----
  const levels = estimateLevels({ masteredVocab, vocabTotal, unitsComplete, unitsTotal, accuracy, conversationSessions: speakingPracticeSessions, listeningAccuracy, listeningReps });
  const hpReadiness = readinessToward(levels.overall.score, 'B1');

  // ---- per-unit vocab breakdown (expand/collapse state lives for this mount) ----
  const progByItem = {};
  progress.forEach((p) => { progByItem[p.item_id] = p; });
  const expandedUnits = new Set();

  function draw() {
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
        <p class="muted" style="margin-top:0;font-size:.85rem">A rough gauge of how much of <b>this curriculum</b> you've mastered, mapped onto CEFR-shaped bands — not an externally validated placement test. 100% here means finishing everything Auf Deutsch currently teaches, which is a smaller vocabulary than a real CEFR exam at the higher bands would expect.</p>
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
        <div class="grid2" style="grid-template-columns:repeat(4,1fr)">
          ${stat(`${streak}🔥`, streak === 1 ? 'Day streak' : 'Day streak')}
          ${stat(lessonSessions, 'Lessons')}
          ${stat(freeSessions, 'Conversations')}
          ${stat(reviewSessions, 'Review runs')}
        </div>
        <p class="muted" style="font-size:.85rem;margin-bottom:0">${active ? `Currently working on <b>${esc(active.title)}</b>.` : 'All units complete — add more in the editor or keep reviewing.'}</p>
      </div>

      ${recentSessionsCard(recentSessionsList, unitsById)}

      ${unitsBreakdown(sections, progByItem, expandedUnits)}
    `;
    wireToggles();
  }

  function wireToggles() {
    el.querySelectorAll('[data-toggle-unit]').forEach((row) => {
      row.onclick = () => {
        const id = row.getAttribute('data-toggle-unit');
        expandedUnits.has(id) ? expandedUnits.delete(id) : expandedUnits.add(id);
        draw();
      };
    });
  }

  draw();
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
const UNIT_STATUS_LABEL = { locked: 'Locked', available: 'Available', in_progress: 'In progress', complete: 'Complete' };

const SESSION_MODE_LABEL = { curriculum: 'Lesson', review: 'Review', free: 'Conversation' };

// Last few sessions with what each one introduced/reviewed and which error
// types came up — the first real reader of items_introduced/items_reviewed/
// errors_observed (see schema.sql, populated since 2026-07-11).
function recentSessionsCard(sessions, unitsById) {
  if (!sessions.length) return '';
  const rows = sessions.map((s) => {
    const modeLabel = SESSION_MODE_LABEL[s.mode] || s.mode;
    const unitTitle = s.unit_id ? (unitsById[s.unit_id]?.title || null) : null;
    const introduced = (s.items_introduced || []).length;
    const reviewed = (s.items_reviewed || []).length;
    const tally = errorTally(s.errors_observed);
    const bits = [];
    if (introduced) bits.push(`+${introduced} new`);
    if (reviewed) bits.push(`${reviewed} reviewed`);
    if (tally) bits.push(tally);
    const dateStr = new Date(s.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<div class="row spread" style="padding:7px 0;border-bottom:1px solid var(--line)">
      <span>
        <b>${esc(modeLabel)}</b>${unitTitle ? ` <span class="muted">· ${esc(unitTitle)}</span>` : ''}
        <span class="muted" style="font-size:.8rem"> · ${dateStr}</span>
      </span>
      <span class="muted" style="font-size:.8rem">${esc(bits.join(' · ') || '—')}</span>
    </div>`;
  }).join('');
  return `<div class="card">
    <h2>Recent sessions</h2>
    <p class="muted" style="margin-top:0;font-size:.85rem">What each of your last ${sessions.length} sessions introduced, reviewed, and which error types came up.</p>
    ${rows}
  </div>`;
}

function errorTally(errors) {
  if (!errors || !errors.length) return '';
  const tally = {};
  errors.forEach((e) => { if (e?.error_type && e.error_type !== 'none') tally[e.error_type] = (tally[e.error_type] || 0) + 1; });
  return Object.entries(tally).map(([t, n]) => `${t}×${n}`).join(', ');
}

// Every section, every unit within it, expandable to the unit's vocab/phrases
// with a mastered / learning / not-started status each — both a record of
// what's done and a preview of what's still ahead.
function unitsBreakdown(sections, progByItem, expandedUnits) {
  if (!sections.length) return '';
  const body = sections.map((s) => {
    const unitsHtml = s.units.length
      ? s.units.map((u) => unitRow(u, progByItem, expandedUnits.has(u.unit_id))).join('')
      : '<p class="muted" style="font-size:.85rem">No units yet.</p>';
    const doneCount = s.units.filter((u) => u.status === 'complete').length;
    return `<div style="margin-bottom:18px">
      <div class="row spread" style="margin-bottom:8px">
        <h3 style="margin:0">${esc(s.title)}</h3>
        <span class="muted" style="font-size:.8rem">${doneCount}/${s.units.length} units complete</span>
      </div>
      ${unitsHtml}
    </div>`;
  }).join('');
  return `<div class="card">
    <h2>By unit</h2>
    <p class="muted" style="margin-top:0;font-size:.85rem">Expand a unit to see its vocabulary and phrases, and whether each is mastered, still being learned, or not started yet — a preview of what's coming.</p>
    ${body}
  </div>`;
}

function unitRow(u, progByItem, open) {
  const threshold = u.mastery_threshold ?? 0.8;
  const vocab = u.vocab || [];
  const total = vocab.length;
  const mastered = vocab.filter((v) => (progByItem[v.vocab_id]?.mastery_score || 0) >= threshold).length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;

  const vocabHtml = total
    ? vocab.map((v) => vocabStatusRow(v, progByItem[v.vocab_id], threshold)).join('')
    : '<p class="muted" style="font-size:.85rem">No vocabulary yet.</p>';

  return `<div class="unit ${u.status}" style="margin-bottom:10px">
    <div class="row spread" data-toggle-unit="${u.unit_id}" style="cursor:pointer">
      <div>
        <span class="unit-title">${esc(u.title)}</span>
        <span class="tag" style="margin-left:8px">${UNIT_STATUS_LABEL[u.status] || u.status}</span>
        <div class="unit-meta">${mastered}/${total} mastered</div>
      </div>
      <div class="row" style="gap:10px">
        <div style="width:90px"><div class="meter"><span style="width:${pct}%"></span></div></div>
        <span class="muted" style="font-size:.8rem">${open ? '▲' : '▼'}</span>
      </div>
    </div>
    ${open ? `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">${vocabHtml}</div>` : ''}
  </div>`;
}

function vocabStatusRow(v, p, threshold) {
  const score = p?.mastery_score || 0;
  const status = !p ? 'new' : score >= threshold ? 'mastered' : 'learning';
  const label = status === 'mastered' ? 'Mastered' : status === 'learning' ? `${Math.round(score * 100)}%` : 'Not started';
  return `<div class="row spread vocab-status-row">
    <span><b class="de-term">${esc(v.german)}</b> — ${esc(v.english)}</span>
    <span class="tag status-${status}">${label}</span>
  </div>`;
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
