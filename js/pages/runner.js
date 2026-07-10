// pages/runner.js — navigate and execute the curriculum. Each lesson runs as a
// four-phase flow:
//   1. Vocabulary  — match this lesson's German ↔ English terms
//   2. Sentences   — single-sentence drills (en→de, de→en, respond in German)
//   3. Conversation— rich tutor chat weaving in this + earlier lessons
//   4. Quiz        — graded leniently (a valid answer counts even if unexpected)
import * as store from '../store.js';
import { buildUnitConvoPrompt, buildSentencePrompt, buildQuizPrompt } from '../prompts.js';
import { quizCall } from '../ai.js';
import { createRichChat, escapeHtml } from '../chatui.js';
import { applyAnswer, unitMeetsThreshold } from '../srs.js';
import { UNIT_COMPLETION_RATIO } from '../config.js';

const PHASES = [
  { key: 'vocab', label: 'Vocabulary' },
  { key: 'sentences', label: 'Sentences' },
  { key: 'conversation', label: 'Conversation' },
  { key: 'quiz', label: 'Quiz' },
];

// A curriculum unit can carry 15-19 vocab items after the frequency-expanded
// seed; a single lesson through all four phases on that much material blows
// past the ~5 minute target. Each curriculum lesson instead pulls only a
// ~SESSION_SIZE-word slice of the unit — but which words is chosen fresh
// every time from live progress data (never-introduced words first, then the
// unit's weakest-mastery words), so repeated lessons sweep across the whole
// unit and re-surface anything shaky instead of drilling the same 5 words
// over and over. The unit unlocks the next one once UNIT_COMPLETION_RATIO of
// the words in the unit — not just the words from the most recent session —
// clear the mastery threshold; the remaining stragglers don't block
// progress, they instead get folded into later units' sentence/quiz pools
// as priority review (see getUnmasteredFromPriorUnits in store.js) so they
// can still reach mastery, and that unit can still be marked complete,
// without a dedicated re-run.
const SESSION_SIZE = 5;

let CTX, ROOT;
let sessionCtx = null;   // { unit, fullUnit, section, sectionTitle, reviewItems, weakPoints, vocabById, mode }
let session = null;      // db session row
let phaseIdx = 0;
let quiz = null;         // { questions, idx, results: [] }
let convo = null;        // rich chat controller for the conversation phase
let lastOutcome = 'in_progress';  // for the sessions log: 'in_progress' | 'unit_complete'

// Pick this session's ~SESSION_SIZE words: never-seen words first (to work
// through the whole unit over successive lessons), then backfill with the
// unit's lowest-mastery already-seen words (to reinforce weak points) until
// the slice is full. Once every word has been introduced, this naturally
// becomes "always drill whatever is currently weakest," which self-corrects
// as mastery scores shift each session — no separate tracking of "which
// microsession am I on" is needed; it's always recomputed from progress.
async function selectSessionVocab(unit, size = SESSION_SIZE) {
  const vocab = (unit.vocab || []).filter((v) => v.german && v.english);
  if (vocab.length <= size) return vocab;

  const progByItem = {};
  (await store.allProgress(CTX.userId)).forEach((p) => { progByItem[p.item_id] = p; });

  const scored = vocab.map((v) => {
    const p = progByItem[v.vocab_id];
    return { v, seen: !!p && (p.times_seen || 0) > 0, mastery: p?.mastery_score || 0 };
  });

  const unseen = scored.filter((s) => !s.seen).map((s) => s.v);
  if (unseen.length >= size) return unseen.slice(0, size);

  const seenWeakestFirst = scored.filter((s) => s.seen).sort((a, b) => a.mastery - b.mastery).map((s) => s.v);
  return [...unseen, ...seenWeakestFirst].slice(0, size);
}

// Unit-wide mastery snapshot for the "up next" card — every vocab item must
// individually clear the threshold, not just whichever ones have a progress
// row yet (an item with no progress at all counts as unmastered).
async function unitMasteryStats(unit) {
  const vocab = (unit.vocab || []).filter((v) => v.german && v.english);
  if (!vocab.length) return { mastered: 0, total: 0 };
  const progByItem = {};
  (await store.allProgress(CTX.userId)).forEach((p) => { progByItem[p.item_id] = p; });
  const threshold = unit.mastery_threshold ?? 0.8;
  const mastered = vocab.filter((v) => (progByItem[v.vocab_id]?.mastery_score || 0) >= threshold).length;
  return { mastered, total: vocab.length };
}

export async function mountRunner(el, ctx) {
  CTX = ctx; ROOT = el;
  await renderLanding();
}

async function renderLanding() {
  session = null; quiz = null; sessionCtx = null; convo = null; phaseIdx = 0;
  const active = await store.getActiveUnit(CTX.userId);
  const sections = await store.getCurriculum(CTX.userId);
  const flatUnits = sections.flatMap((s) => s.units.map((u) => ({ ...u, _section: s.title, section_id: s.section_id })));

  let progressInfo = '';
  if (active) {
    const { mastered, total } = await unitMasteryStats(active.unit);
    progressInfo = total > SESSION_SIZE
      ? `${mastered} / ${total} words mastered so far · each lesson drills ~${SESSION_SIZE}, mixing new words with whatever still needs work`
      : `${mastered} / ${total} words mastered`;
  }

  ROOT.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Today</div>
      <h1>Curriculum runner</h1>
      <p>Each lesson moves through four phases: match the vocabulary, drill single sentences, hold a conversation, then take the quiz — pulling a ~${SESSION_SIZE}-word slice of the unit each time so a lesson stays under 5 minutes. A unit unlocks the next one once ${Math.round(UNIT_COMPLETION_RATIO * 100)}% of its words are mastered — any stragglers keep getting prioritized into later units' sentence and quiz phases until they clear too, so old units can finish without a dedicated re-run.</p>
    </div>

    ${active ? `
      <div class="card">
        <div class="eyebrow">Up next</div>
        <h2>${esc(active.unit.title)}</h2>
        <div class="unit-meta" style="margin:4px 0 4px">${esc(active.section.title)} · ${(active.unit.objectives || []).join(' · ') || '—'}</div>
        <div class="unit-meta" style="margin:0 0 12px">${esc(progressInfo)}</div>
        <button class="btn primary" id="start-active">Start lesson</button>
      </div>
    ` : `<div class="empty"><h3>All units complete 🎉</h3><p>Use review mode below to keep things fresh, or add new units in the editor.</p></div>`}

    <div class="card">
      <h2>Review mode</h2>
      <p class="muted" style="margin-top:0">Run any unit through the full four-phase flow, regardless of schedule. Unlike a regular lesson, this pulls the unit's <b>entire</b> vocabulary into the matching phase (not the ~${SESSION_SIZE}-word slice) — a bigger unit can take a fair bit longer than ~5 minutes.</p>
      <div class="row wrap">
        <select id="review-pick" style="flex:1;min-width:220px">
          <option value="">Choose a unit to review…</option>
          ${flatUnits.map((u) => `<option value="${u.unit_id}">${esc(u._section)} — ${esc(u.title)}</option>`).join('')}
        </select>
        <button class="btn" id="start-review">Review this unit</button>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost sm" id="start-due">Review everything due (${(await store.getDueReviewItems(CTX.userId)).length})</button>
      </div>
    </div>
  `;

  const startActive = ROOT.querySelector('#start-active');
  if (startActive) startActive.onclick = () => startSession(active.unit, active.section, 'curriculum');

  ROOT.querySelector('#start-review').onclick = async () => {
    const id = ROOT.querySelector('#review-pick').value; if (!id) return;
    const sec = sections.find((s) => s.units.some((u) => u.unit_id === id));
    const unit = sec.units.find((u) => u.unit_id === id);
    startSession(unit, sec, 'review');
  };
  ROOT.querySelector('#start-due').onclick = () => startDueReview(sections);
}

function buildVocabMap(sections) {
  const map = {};
  sections.forEach((s) => s.units.forEach((u) => (u.vocab || []).forEach((v) => { map[v.vocab_id] = v; })));
  return map;
}

function buildUnitsMap(sections) {
  const map = {};
  sections.forEach((s) => s.units.forEach((u) => { map[u.unit_id] = u; }));
  return map;
}

async function buildContext(unit, section, mode) {
  const sections = await store.getCurriculum(CTX.userId);
  const vocabById = buildVocabMap(sections);
  const unitsById = buildUnitsMap(sections);
  const [reviewItems, weakPoints, priorWeak] = await Promise.all([
    store.getDueReviewItems(CTX.userId),
    store.getWeakPoints(CTX.userId),
    mode === 'curriculum' ? store.getUnmasteredFromPriorUnits(CTX.userId, unit.unit_id) : Promise.resolve([]),
  ]);
  return { unit, section, sectionTitle: section?.title, reviewItems, weakPoints, priorWeak, vocabById, unitsById, mode };
}

async function startSession(unit, section, mode) {
  lastOutcome = 'in_progress';
  sessionCtx = await buildContext(unit, section, mode);
  if (mode === 'curriculum') {
    sessionCtx.unit = { ...unit, vocab: await selectSessionVocab(unit) };
    sessionCtx.fullUnit = unit;
  }
  session = await store.createSession(CTX.userId, { mode, unit_id: unit.unit_id });
  if (mode === 'curriculum' && unit.status === 'available') {
    await store.updateUnit(unit.unit_id, { status: 'in_progress' });
  }
  phaseIdx = 0;
  renderSession();
}

async function startDueReview(sections) {
  lastOutcome = 'in_progress';
  const due = await store.getDueReviewItems(CTX.userId, 12);
  if (!due.length) { alert('Nothing due right now — nicely done.'); return; }
  const vocabById = buildVocabMap(sections);
  const unitsById = buildUnitsMap(sections);
  const pseudoUnit = { title: 'Due review', objectives: ['refresh items due for review'], grammar_focus: [], vocab: due.map((p) => vocabById[p.item_id]).filter(Boolean) };
  sessionCtx = { unit: pseudoUnit, section: null, sectionTitle: 'Review', reviewItems: due, weakPoints: [], priorWeak: [], vocabById, unitsById, mode: 'review' };
  session = await store.createSession(CTX.userId, { mode: 'review', unit_id: null });
  phaseIdx = 0;
  renderSession();
}

// ---- session scaffold + phase router --------------------------------------
function renderSession() {
  const wordLabel = sessionCtx.fullUnit && sessionCtx.unit.vocab.length < sessionCtx.fullUnit.vocab.length
    ? ` · ${sessionCtx.unit.vocab.length} of ${sessionCtx.fullUnit.vocab.length} words`
    : '';
  ROOT.innerHTML = `
    <div class="row spread" style="margin-bottom:14px">
      <div>
        <div class="eyebrow">${sessionCtx.mode === 'review' ? 'Review' : 'Lesson'}${esc(wordLabel)}</div>
        <h1 style="font-size:1.4rem">${esc(sessionCtx.unit.title)}</h1>
      </div>
      <button class="btn ghost sm" id="end-session">End session</button>
    </div>
    <div class="stepper" id="stepper">
      ${PHASES.map((p, i) => `<div class="step" data-step="${i}"><span class="step-dot">${i + 1}</span><span class="step-label">${p.label}</span></div>`).join('<div class="step-link"></div>')}
    </div>
    <div id="phase-zone"></div>
  `;
  ROOT.querySelector('#end-session').onclick = endSession;
  mountPhase();
}

function updateStepper() {
  ROOT.querySelectorAll('.step').forEach((s, i) => {
    s.classList.toggle('active', i === phaseIdx);
    s.classList.toggle('done', i < phaseIdx);
  });
}

function nextPhase() {
  phaseIdx = Math.min(phaseIdx + 1, PHASES.length - 1);
  mountPhase();
}

function mountPhase() {
  updateStepper();
  const key = PHASES[phaseIdx].key;
  if (key === 'vocab') mountVocabPhase();
  else if (key === 'sentences') mountSentencePhase();
  else if (key === 'conversation') mountConvoPhase();
  else if (key === 'quiz') mountQuizPhase();
}

// ---- Phase 1: vocabulary matching -----------------------------------------
function mountVocabPhase() {
  const zone = ROOT.querySelector('#phase-zone');
  const vocab = (sessionCtx.unit.vocab || []).filter((v) => v.german && v.english);
  if (vocab.length < 2) {
    zone.innerHTML = `<div class="card"><p class="muted">No vocabulary to match for this unit — moving on.</p><button class="btn primary" id="skip-vocab">Continue →</button></div>`;
    zone.querySelector('#skip-vocab').onclick = nextPhase;
    return;
  }
  const left = vocab.map((v, i) => ({ id: v.vocab_id || ('v' + i), text: v.german }));
  const right = shuffle(vocab.map((v, i) => ({ id: v.vocab_id || ('v' + i), text: v.english })));

  zone.innerHTML = `
    <div class="card">
      <div class="eyebrow">Phase 1 · Match the pairs</div>
      <h3 style="margin:6px 0 4px">Tap a German word, then its English meaning</h3>
      <p class="muted" style="font-size:.84rem;margin-top:0">This is the vocabulary for the rest of the lesson.</p>
      <div class="match-grid">
        <div class="match-col">${left.map((x) => `<button class="match-item" data-side="de" data-id="${esc(x.id)}">${esc(x.text)}</button>`).join('')}</div>
        <div class="match-col">${right.map((x) => `<button class="match-item" data-side="en" data-id="${esc(x.id)}">${esc(x.text)}</button>`).join('')}</div>
      </div>
      <div class="row spread" style="margin-top:14px">
        <span class="muted" id="match-progress">0 / ${vocab.length} matched</span>
        <button class="btn primary" id="vocab-continue" disabled>Continue →</button>
      </div>
    </div>
  `;

  let selected = null;       // {el, id}
  let matched = 0;
  const items = zone.querySelectorAll('.match-item');
  items.forEach((b) => b.onclick = () => {
    if (b.classList.contains('matched')) return;
    if (b.dataset.side === 'de') {
      zone.querySelectorAll('.match-item[data-side="de"]').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      selected = { el: b, id: b.dataset.id };
      return;
    }
    // clicked an English item
    if (!selected) return;
    if (b.dataset.id === selected.id) {
      b.classList.add('matched'); selected.el.classList.add('matched'); selected.el.classList.remove('sel');
      selected = null; matched++;
      zone.querySelector('#match-progress').textContent = `${matched} / ${vocab.length} matched`;
      if (matched === vocab.length) zone.querySelector('#vocab-continue').disabled = false;
    } else {
      b.classList.add('miss'); const bad = selected.el;
      setTimeout(() => { b.classList.remove('miss'); bad.classList.remove('sel'); }, 450);
      selected = null;
    }
  });
  zone.querySelector('#vocab-continue').onclick = nextPhase;
}

// ---- Phase 2: single-sentence practice ------------------------------------
async function mountSentencePhase() {
  const zone = ROOT.querySelector('#phase-zone');
  zone.innerHTML = `<div class="card"><p class="muted">Building sentence drills…</p></div>`;
  let items = [];
  try {
    const gen = await quizCall(buildSentencePrompt(sessionCtx), 'Generate the sentence drills now.');
    items = (gen.items || []).filter((it) => isWellFormed(it, { allowFillBlank: false }));
  } catch (e) {
    // Mirror the quiz phase's retry pattern (transient network/API hiccups
    // shouldn't force skipping the whole phase) while keeping a skip escape
    // hatch in case retrying doesn't help (e.g. a missing/invalid API key).
    zone.innerHTML = `<div class="card"><p class="verdict wrong">Couldn't build sentences: ${esc(e.message)}</p>
      <div class="row" style="margin-top:8px;gap:8px">
        <button class="btn primary" id="retry-sent">Try again</button>
        <button class="btn ghost" id="skip-sent">Skip to conversation →</button>
      </div></div>`;
    zone.querySelector('#retry-sent').onclick = mountSentencePhase;
    zone.querySelector('#skip-sent').onclick = nextPhase;
    return;
  }
  if (!items.length) { nextPhase(); return; }

  let idx = 0;
  renderSentence();

  function renderSentence() {
    if (idx >= items.length) {
      zone.innerHTML = `<div class="card"><div class="eyebrow">Phase 2 complete</div><h3 style="margin:6px 0 10px">Nice — sentences done.</h3><button class="btn primary" id="sent-continue">Continue to conversation →</button></div>`;
      zone.querySelector('#sent-continue').onclick = nextPhase;
      return;
    }
    const it = items[idx];
    zone.innerHTML = `
      <div class="card qcard">
        <div class="eyebrow">Phase 2 · Sentence ${idx + 1} of ${items.length} · ${esc(typeLabel(it.type))}</div>
        <h3 style="margin:6px 0 12px">${esc(it.prompt)}</h3>
        <div class="composer">
          <input id="sent-ans" placeholder="${it.type === 'de_to_en' ? 'Your English sentence' : 'Dein deutscher Satz'}" autocomplete="off">
          <button class="btn primary" id="sent-check">Check</button>
        </div>
        <div id="sent-verdict"></div>
      </div>
    `;
    const ans = zone.querySelector('#sent-ans');
    const checkBtn = zone.querySelector('#sent-check');
    ans.focus();
    const check = () => gradeSentence(it, ans.value.trim());
    checkBtn.onclick = check;
    ans.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  }

  // Guarded against double-submit: a double-click, or Enter followed by a
  // click, could otherwise fire two grading calls for the same sentence
  // before the first resolves, each independently updating SRS progress
  // (double-counting times_seen and potentially double-advancing/dropping
  // the SRS ladder for one answer).
  async function gradeSentence(it, answer) {
    if (!answer) return;
    const checkBtn = zone.querySelector('#sent-check');
    const ansEl = zone.querySelector('#sent-ans');
    if (checkBtn.disabled) return;
    checkBtn.disabled = true; ansEl.disabled = true;
    const vEl = zone.querySelector('#sent-verdict');
    vEl.innerHTML = `<p class="muted">Checking…</p>`;
    let verdict;
    try {
      verdict = await quizCall(buildQuizPrompt(sessionCtx, 'grade'),
        `Type: ${it.type}\nPrompt: ${it.prompt}\nIntended answer: ${it.answer}\nLearner's answer: ${answer}`);
    } catch (e) {
      vEl.innerHTML = `<p class="verdict wrong">${esc(e.message)}</p>`;
      checkBtn.disabled = false; ansEl.disabled = false;
      return;
    }
    zone.querySelector('.qcard').classList.add(verdict.correct ? 'correct' : 'wrong');
    vEl.innerHTML = verdictHtml(verdict, it.answer) +
      `<button class="btn sm" id="sent-next" style="margin-top:8px">${idx + 1 < items.length ? 'Next sentence' : 'Finish phase'}</button>`;
    await recordResult(it, verdict);
    zone.querySelector('#sent-next').onclick = () => { idx++; renderSentence(); };
  }
}

// ---- Phase 3: conversation -------------------------------------------------
function mountConvoPhase() {
  const zone = ROOT.querySelector('#phase-zone');
  zone.innerHTML = `
    <div class="card">
      <div class="eyebrow">Phase 3 · Conversation</div>
      <p class="muted" style="font-size:.84rem;margin-top:2px">This lesson's words plus concepts from earlier lessons, in a real back-and-forth.</p>
      <div id="convo-rich"></div>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn primary" id="convo-continue">Continue to quiz →</button>
      <span class="muted" style="font-size:.82rem;margin-left:8px">Chat as long as you like, then take the quiz.</span>
    </div>
  `;
  convo = createRichChat(zone.querySelector('#convo-rich'), {
    getSystemPrompt: () => buildUnitConvoPrompt(sessionCtx),
    placeholder: 'Type in German…',
  });
  convo.open('Begin the conversation now with a natural German greeting tied to this unit.');
  zone.querySelector('#convo-continue').onclick = nextPhase;
}

// ---- Phase 4: quiz ---------------------------------------------------------
async function mountQuizPhase() {
  const zone = ROOT.querySelector('#phase-zone');
  zone.innerHTML = `<div class="card"><p class="muted">Building quiz…</p></div>`;
  try {
    const gen = await quizCall(buildQuizPrompt(sessionCtx, 'generate'), 'Generate the quiz now.');
    const questions = (gen.questions || []).filter((q) => isWellFormed(q, { allowFillBlank: true }));
    quiz = { questions, idx: 0, results: [] };
    if (!quiz.questions.length) throw new Error('No questions returned.');
    renderQuestion();
  } catch (e) {
    zone.innerHTML = `<div class="card"><p class="verdict wrong">Quiz failed: ${esc(e.message)}</p><button class="btn" id="quiz-retry">Try again</button></div>`;
    zone.querySelector('#quiz-retry').onclick = mountQuizPhase;
  }
}

function renderQuestion() {
  const zone = ROOT.querySelector('#phase-zone');
  if (quiz.idx >= quiz.questions.length) return finishQuiz();
  const q = quiz.questions[quiz.idx];
  zone.innerHTML = `
    <div class="card qcard">
      <div class="eyebrow">Phase 4 · Question ${quiz.idx + 1} of ${quiz.questions.length} · ${esc(typeLabel(q.type))}</div>
      <h3 style="margin:6px 0 12px">${esc(q.prompt)}</h3>
      <div class="composer">
        <input id="ans" placeholder="Your answer" autocomplete="off">
        <button class="btn primary" id="submit-ans">Check</button>
      </div>
      <div id="verdict"></div>
    </div>
  `;
  const ans = zone.querySelector('#ans');
  ans.focus();
  const check = () => gradeAnswer(q, ans.value.trim());
  zone.querySelector('#submit-ans').onclick = check;
  ans.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
}

// Guarded against double-submit — see gradeSentence's comment above for why
// (a duplicate in-flight grading call double-counts SRS progress).
async function gradeAnswer(q, answer) {
  if (!answer) return;
  const zone = ROOT.querySelector('#phase-zone');
  const vEl = zone.querySelector('#verdict');
  const btn = zone.querySelector('#submit-ans');
  const ansEl = zone.querySelector('#ans');
  if (btn.disabled) return;
  btn.disabled = true; ansEl.disabled = true;
  vEl.innerHTML = `<p class="muted">Grading…</p>`;
  let verdict;
  try {
    verdict = await quizCall(buildQuizPrompt(sessionCtx, 'grade'),
      `Type: ${q.type}\nQuestion: ${q.prompt}\nIntended answer: ${q.answer}\nLearner's answer: ${answer}`);
  } catch (e) {
    vEl.innerHTML = `<p class="verdict wrong">${esc(e.message)}</p>`;
    btn.disabled = false; ansEl.disabled = false;
    return;
  }

  zone.querySelector('.qcard').classList.add(verdict.correct ? 'correct' : 'wrong');
  vEl.innerHTML = verdictHtml(verdict, q.answer) +
    `<button class="btn sm" id="next-q" style="margin-top:8px">${quiz.idx + 1 < quiz.questions.length ? 'Next question' : 'See results'}</button>`;
  await recordResult(q, verdict);
  quiz.results.push({ q, verdict });
  zone.querySelector('#next-q').onclick = () => { quiz.idx++; renderQuestion(); };
}

// Shared verdict rendering — shows the intended solution whenever the grader
// supplied one (i.e. the learner's answer differed from what was intended).
function verdictHtml(verdict, fallbackAnswer) {
  const intended = (verdict.intended && verdict.intended.trim()) || (!verdict.correct ? fallbackAnswer : '');
  return `<p class="verdict ${verdict.correct ? 'correct' : 'wrong'}">${verdict.correct ? '✓ Correct' : '✗ Not quite'} — ${esc(verdict.feedback || '')}</p>` +
    (intended ? `<p class="muted intended" style="font-size:.85rem">Intended: ${esc(intended)}</p>` : '');
}

function typeLabel(t) {
  return ({ en_to_de: 'English → German', de_to_en: 'German → English', respond_de: 'Answer in German', fill_blank: 'Fill in the blank' })[t] || t || '';
}

// item_label is free text from the AI grader, not a stable id — resolve it to
// a vocab row by matching its German/English text against the label. Picks
// the LONGEST matching text rather than the first hit found, so a short item
// that happens to be a prefix of a longer one (e.g. "Ich bin" / "Ich bin
// Student") doesn't steal every answer meant for the longer, more specific
// phrase.
function resolveVocabByLabel(label, vocabById) {
  let best = null, bestLen = 0;
  for (const v of Object.values(vocabById)) {
    const de = (v.german || '').toLowerCase();
    const en = (v.english || '').toLowerCase();
    const len = Math.max(de && label.includes(de) ? de.length : 0, en && label.includes(en) ? en.length : 0);
    if (len > bestLen) { bestLen = len; best = v; }
  }
  return best;
}

// Map a graded answer back onto a progress record + SRS update.
async function recordResult(q, verdict) {
  const label = (q.item_label || '').toLowerCase();
  if (!label) return; // respond-in-German / grammar-only — nothing to map
  const vocab = resolveVocabByLabel(label, sessionCtx.vocabById);
  if (!vocab) return;
  const itemId = vocab.vocab_id;
  const existing = (await store.getProgress(CTX.userId, itemId)) || {};
  const upd = applyAnswer(existing, !!verdict.correct);
  const known = new Set(existing.known_errors || []);
  if (!verdict.correct && verdict.error_type && verdict.error_type !== 'none') known.add(verdict.error_type);
  await store.upsertProgress(CTX.userId, itemId, {
    item_type: 'vocab', unit_id: vocab.unit_id, known_errors: [...known], ...upd,
  });

  // This answer can belong to an earlier unit pulled in as priority review
  // (or a unit being reviewed directly) rather than the unit driving this
  // session. Re-check THAT unit's own completion too, so it can cross the
  // finish line passively as its stragglers get mopped up here, instead of
  // needing a dedicated re-run once it's already this close.
  if (vocab.unit_id !== sessionCtx.fullUnit?.unit_id) {
    const owningUnit = sessionCtx.unitsById?.[vocab.unit_id];
    if (owningUnit && owningUnit.status !== 'complete' && owningUnit.status !== 'locked') {
      const promoted = await maybePromote(owningUnit);
      if (promoted) (sessionCtx.promotedPriorUnits ||= []).push(owningUnit.title);
    }
  }
}

async function finishQuiz() {
  const right = quiz.results.filter((r) => r.verdict.correct).length;
  const total = quiz.results.length;
  const zone = ROOT.querySelector('#phase-zone');
  let unitComplete = false;
  lastOutcome = 'in_progress';
  if (sessionCtx.mode === 'curriculum' && sessionCtx.fullUnit) {
    unitComplete = await maybePromote(sessionCtx.fullUnit);
    if (unitComplete) lastOutcome = 'unit_complete';
  }

  const message = unitComplete
    ? `<p class="verdict correct">Unit mastered — the next unit is unlocked.</p>`
    : `<p class="muted">Keep at it — items you missed will resurface in review, and future lessons in this unit will keep mixing in whatever still needs work until the unit clears ${Math.round(UNIT_COMPLETION_RATIO * 100)}% mastery.</p>`;
  const priorNote = sessionCtx.promotedPriorUnits?.length
    ? `<p class="verdict correct" style="margin-top:6px">Also just crossed the finish line: ${sessionCtx.promotedPriorUnits.map(esc).join(', ')} 🎉</p>`
    : '';

  zone.innerHTML = `
    <div class="card">
      <div class="eyebrow">Lesson complete</div>
      <h2>${right} / ${total} correct</h2>
      ${message}
      ${priorNote}
      <button class="btn primary" id="back" style="margin-top:10px">Back to runner</button>
    </div>
  `;
  zone.querySelector('#back').onclick = endSession;
}

// The unit as a whole is mastered — and the next unit unlocks — once
// UNIT_COMPLETION_RATIO of its vocab items individually clear the mastery
// threshold (not necessarily every one — see config.js). An item with no
// progress row yet (never drilled) counts as unmastered, so a unit can't
// complete just because the words that happened to get seen were easy.
async function maybePromote(unit) {
  const vocab = (unit.vocab || []).filter((v) => v.german && v.english);
  if (!vocab.length) return false;
  const progByItem = {};
  (await store.allProgress(CTX.userId)).forEach((p) => { progByItem[p.item_id] = p; });
  const threshold = unit.mastery_threshold ?? 0.8;
  const records = vocab.map((v) => progByItem[v.vocab_id] || { mastery_score: 0 });
  if (!unitMeetsThreshold(records, threshold, UNIT_COMPLETION_RATIO)) return false;

  await store.updateUnit(unit.unit_id, { status: 'complete' });
  const sections = await store.getCurriculum(CTX.userId);
  const flat = sections.flatMap((s) => s.units);
  const next = flat.find((u) => u.status === 'locked');
  if (next) await store.updateUnit(next.unit_id, { status: 'available' });
  return true;
}

async function endSession() {
  if (session) {
    await store.updateSession(session.session_id, { ended_at: new Date().toISOString(), outcome: lastOutcome });
  }
  await renderLanding();
}

// Drops items whose prompt/answer don't hold together — the model occasionally
// blends fields between items in a batch, especially for fill_blank (a mismatched
// blank/answer pair makes the question impossible to answer correctly). Better to
// show one fewer item than an unanswerable one.
function isWellFormed(it, { allowFillBlank } = {}) {
  if (!it || !it.prompt || !it.answer) return false;
  const prompt = String(it.prompt).trim();
  const answer = String(it.answer).trim();
  if (!prompt || !answer) return false;
  if (it.type === 'fill_blank') {
    if (!allowFillBlank) return false;
    if (!/_{3,}/.test(prompt)) return false;               // must contain a blank marker
    if (/[.!?].*[.!?]/.test(answer)) return false;          // answer reads like >1 sentence
  }
  return true;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function esc(s) { return escapeHtml(s); }
