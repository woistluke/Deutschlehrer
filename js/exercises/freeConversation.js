// exercises/freeConversation.js — "Free Conversation": free-practice German
// chat, with the full feature set ported from the original single-file app —
// level + topic setup, structured replies (translation, inline corrections,
// tips, vocab chips), flashcards from collected vocab, missed-card tracking,
// and a session review. Was its own top-level nav tab; now lives in the
// Exercises catalog alongside the other standalone practice games.
import { createRichChat, escapeHtml } from '../chatui.js';
import { buildFreeConvoPrompt } from '../prompts.js';
import * as store from '../store.js';

export const meta = {
  id: 'free-conversation',
  title: 'Free Conversation',
  blurb: 'Just talk — pick a level and topic, no scoring. Words the tutor uses become flashcards.',
};

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const TOPICS = ['Greetings & Small Talk', 'Ordering Food', 'Shopping', 'Travel & Directions',
  'Work & Career', 'Family & Home', 'Hobbies & Interests', 'Health & Body', 'Weather', 'Free Conversation'];

// Namespaced per handle (see IMPROVEMENT_LOG.md 2026-07-20 item 3) — every
// other piece of app state (curriculum, progress, sessions, content
// feedback) is scoped by user_id via store.js, even on the localStorage
// fallback, matching the README's promise that switching handles switches
// whose data you see. These two keys used to be flat/global, so testing a
// second handle in the same browser leaked one handle's missed-flashcard
// queue and default level/topic into the other's.
const LS_PREFS_BASE = 'aufdeutsch.freeconvo';
const LS_MISSED_BASE = 'aufdeutsch.missed';

// One-time carry-forward from the old flat (unscoped) key to the new
// namespaced one, so switching to per-handle keys doesn't silently reset
// Luke's real missed-card queue/prefs back to defaults the first time this
// loads. Only migrates if the namespaced key doesn't exist yet AND then
// removes the old flat key -- otherwise a second handle's first load would
// also see the old key and wrongly inherit the first handle's data (the
// bug this migration exists to fix, just delayed instead of avoided).
function migrateFlatKey(base, userId) {
  const oldKey = base, newKey = `${base}.${userId}`;
  if (localStorage.getItem(newKey) != null) return;
  const old = localStorage.getItem(oldKey);
  if (old == null) return;
  localStorage.setItem(newKey, old);
  localStorage.removeItem(oldKey);
}

function loadPrefs(userId) {
  migrateFlatKey(LS_PREFS_BASE, userId);
  try { return JSON.parse(localStorage.getItem(`${LS_PREFS_BASE}.${userId}`)) || {}; } catch { return {}; }
}
function savePrefs(userId, p) { localStorage.setItem(`${LS_PREFS_BASE}.${userId}`, JSON.stringify(p)); }
function loadMissed(userId) {
  migrateFlatKey(LS_MISSED_BASE, userId);
  try { return JSON.parse(localStorage.getItem(`${LS_MISSED_BASE}.${userId}`)) || []; } catch { return []; }
}
function saveMissed(userId, m) { localStorage.setItem(`${LS_MISSED_BASE}.${userId}`, JSON.stringify(m)); }

export function mount(el, ctx) {
  const prefs = loadPrefs(ctx.userId);
  const view = {
    screen: 'setup',                       // setup | chat | flashcards | review
    level: prefs.level || 'A2',
    topic: prefs.topic || 'Greetings & Small Talk',
    vocab: [],                             // collected this session
    missed: loadMissed(ctx.userId),
    flash: { queue: [], idx: 0, flipped: false, score: { got: 0, missed: 0 } },
    started: false,
  };
  let chat = null;
  // Cross-session error-type trend (see store.recentErrorTrend) -- fetched
  // once per mount and threaded into buildFreeConvoPrompt so this surface
  // can also lean toward Luke's recently recurring error types, the same
  // way the curriculum-tied prompts already do (see IMPROVEMENT_LOG.md
  // 2026-07-18 item 3). Same "don't let this break the exercise" defensive
  // .catch() as runner.js's usage.
  let errorTrend = [];
  // Flagged-issue notes for the conversation surface (see feedback.js's
  // "⚑ Something wrong with this?" affordance, now wired onto tutor bubbles
  // via chatui.js's flagCtx) -- read back into buildFreeConvoPrompt via
  // pastIssuesBlock, same pattern as errorTrend above. Previously Free
  // Conversation had no feedback loop at all (see IMPROVEMENT_LOG.md
  // 2026-07-20 item 1).
  let pastConvoIssues = [];
  // Snapshot of the chat's message history captured whenever we leave the
  // chat screen for flashcards/review, so returning to chat resumes the same
  // conversation instead of starting a brand-new one (and re-sending an
  // opening greeting). Only a genuine "change topic" / fresh start clears it.
  let savedHistory = null;
  // The one session row for the current chat, so Stats' streak/session counts
  // (built from the `sessions` table — see js/pages/runner.js for the same
  // pattern on the curriculum side) include free-conversation practice, not
  // just curriculum/review lessons. Created once when a genuinely new
  // conversation starts; carried through flashcards/review round-trips;
  // closed out when the learner changes topic or picks a new one.
  let sessionId = null;

  function rerender() {
    if (view.screen === 'setup') renderSetup();
    else if (view.screen === 'chat') renderChat();
    else if (view.screen === 'flashcards') renderFlashcards();
    else if (view.screen === 'review') renderReview();
  }

  // ---- setup ----------------------------------------------------------------
  function renderSetup() {
    el.innerHTML = `
      <div class="page-head">
        <div class="row spread" style="align-items:flex-start">
          <div class="eyebrow" style="margin-bottom:0">Practice</div>
          <button class="btn ghost sm" id="ex-back">← Exercises</button>
        </div>
        <h1>Free conversation</h1>
        <p>Just talk — no curriculum, no scoring. Pick a level and topic, then chat. Words the tutor uses become flashcards.</p>
      </div>
      <div class="card">
        <div class="field-label">Your level</div>
        <div class="pickrow">
          ${LEVELS.map((l) => `<button class="pick ${view.level === l ? 'on' : ''}" data-level="${l}">${l}</button>`).join('')}
        </div>
        <div class="field-label" style="margin-top:16px">Topic</div>
        <div class="pickcol">
          ${TOPICS.map((t) => `<button class="pick wide ${view.topic === t ? 'on' : ''}" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
        </div>
        <button class="btn primary" id="start" style="margin-top:18px;width:100%">Gespräch beginnen →</button>
        ${view.missed.length ? `<button class="btn ghost" id="open-missed-setup" style="margin-top:8px;width:100%">🔁 Review ${view.missed.length} missed card${view.missed.length > 1 ? 's' : ''}</button>` : ''}
      </div>
    `;
    el.querySelectorAll('[data-level]').forEach((b) => b.onclick = () => { view.level = b.dataset.level; savePrefs(ctx.userId, { level: view.level, topic: view.topic }); renderSetup(); });
    el.querySelectorAll('[data-topic]').forEach((b) => b.onclick = () => { view.topic = b.dataset.topic; savePrefs(ctx.userId, { level: view.level, topic: view.topic }); renderSetup(); });
    el.querySelector('#start').onclick = startChat;
    el.querySelector('#ex-back').onclick = () => ctx.go('exercises');
    const om = el.querySelector('#open-missed-setup');
    if (om) om.onclick = () => startFlashcards(view.missed);
  }

  function startChat() {
    savedHistory = null; // starting fresh from setup — new topic, new conversation
    sessionId = null;
    view.screen = 'chat';
    renderChat();
    if (ctx?.userId) {
      store.createSession(ctx.userId, { mode: 'free' })
        .then((s) => { sessionId = s?.session_id || null; })
        .catch((e) => console.error('Failed to log conversation session:', e));
      store.recentErrorTrend(ctx.userId)
        .then((t) => { errorTrend = t || []; })
        .catch(() => { errorTrend = []; });
      store.allContentFeedback(ctx.userId)
        .then((all) => { pastConvoIssues = store.recentFeedbackNotes(all, 'conversation'); })
        .catch(() => { pastConvoIssues = []; });
    }
  }

  // Close out the current session row, if any (fire-and-forget — losing this
  // update just leaves outcome/ended_at as their defaults, it doesn't affect
  // Stats since streak/session counts key off started_at, not ended_at).
  // outcome is 'ended' rather than 'in_progress' -- this call sets a real
  // ended_at timestamp in the same write, so leaving outcome as
  // 'in_progress' would contradict it and permanently mislabel every
  // properly-closed free-conversation session as still in progress. Neither
  // of schema.sql's other documented outcome values ('unit_complete') fits
  // a free-chat session either, since there's no unit involved.
  function endConversationSession() {
    if (!sessionId) return;
    const id = sessionId;
    sessionId = null;
    return store.updateSession(id, { ended_at: new Date().toISOString(), outcome: 'ended' })
      .catch((e) => console.error('Failed to close conversation session:', e));
  }

  // ---- chat -----------------------------------------------------------------
  function renderChat() {
    el.innerHTML = `
      <div class="row spread" style="margin-bottom:14px">
        <div>
          <div class="eyebrow">Conversation</div>
          <h1 style="font-size:1.4rem">${view.level} · ${escapeHtml(view.topic)}</h1>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn sm" id="open-cards">📚 <span id="cards-count">${view.vocab.length}</span></button>
          ${view.missed.length ? `<button class="btn sm" id="open-missed">🔁 ${view.missed.length}</button>` : ''}
          <button class="btn ghost sm" id="back-setup">Change topic</button>
          <button class="btn ghost sm" id="ex-back">← Exercises</button>
        </div>
      </div>
      <div class="card">
        <div id="rich"></div>
      </div>
    `;
    // "Change topic" is the one path that should genuinely restart the
    // conversation — clear any saved history so the new chat instance opens fresh.
    el.querySelector('#back-setup').onclick = () => { savedHistory = null; endConversationSession(); view.screen = 'setup'; renderSetup(); };
    el.querySelector('#ex-back').onclick = () => { endConversationSession(); ctx.go('exercises'); };
    el.querySelector('#open-cards').onclick = () => { savedHistory = chat.getHistory(); startFlashcards(view.vocab); };
    const om = el.querySelector('#open-missed');
    if (om) om.onclick = () => { savedHistory = chat.getHistory(); startFlashcards(view.missed); };

    const resuming = !!(savedHistory && savedHistory.length);
    chat = createRichChat(el.querySelector('#rich'), {
      getSystemPrompt: () => buildFreeConvoPrompt({ level: view.level, topic: view.topic, errorTrend, pastIssues: pastConvoIssues }),
      initialMessages: savedHistory,
      onVocab: (list) => {
        view.vocab = list;
        const c = el.querySelector('#cards-count');
        if (c) c.textContent = list.length;
      },
      flagCtx: { userId: ctx.userId, contextType: 'conversation', unitId: null, unitTitle: view.topic },
    });
    savedHistory = null; // consumed — the new instance now owns this history
    // Only open with a fresh greeting for a genuinely new conversation. Returning
    // from flashcards/review restores the prior messages instead (see above).
    if (!resuming) {
      chat.open(`Start the conversation with a natural German greeting or opening question about "${view.topic}".`);
    }
    view.started = true;
  }

  // ---- flashcards -----------------------------------------------------------
  function startFlashcards(cards) {
    if (!cards || !cards.length) { alert('No cards yet — keep chatting to collect vocabulary.'); return; }
    view.flash = { queue: cards.slice(), idx: 0, flipped: false, score: { got: 0, missed: 0 } };
    view.screen = 'flashcards';
    renderFlashcards();
  }

  function renderFlashcards() {
    const { queue, idx, flipped } = view.flash;
    const card = queue[idx];
    el.innerHTML = `
      <div class="row spread" style="margin-bottom:14px">
        <div><div class="eyebrow">Flashcards</div><h1 style="font-size:1.4rem">Card ${idx + 1} / ${queue.length}</h1></div>
        <button class="btn ghost sm" id="fc-exit">Back to chat</button>
      </div>
      <div class="card flashcard-wrap">
        <div class="flashcard ${flipped ? 'flipped' : ''}" id="flip">
          <div class="fc-side-label">${flipped ? 'English' : 'German'}</div>
          <div class="fc-term">${escapeHtml(flipped ? card.en : card.de)}</div>
          ${!flipped ? `<div class="fc-hint">tap to reveal</div>` : ''}
        </div>
        ${flipped ? `
          <div class="row" style="justify-content:center;gap:12px;margin-top:18px">
            <button class="btn fc-got" data-result="got">✓ Got it</button>
            <button class="btn fc-missed" data-result="missed">✗ Missed</button>
          </div>` : ''}
        <button class="btn ghost sm" id="fc-skip" style="margin-top:10px">skip</button>
      </div>
    `;
    el.querySelector('#fc-exit').onclick = () => { view.screen = 'chat'; renderChat(); };
    el.querySelector('#flip').onclick = () => { view.flash.flipped = !view.flash.flipped; renderFlashcards(); };
    el.querySelector('#fc-skip').onclick = advanceFlash;
    el.querySelectorAll('[data-result]').forEach((b) => b.onclick = () => handleFlashResult(b.dataset.result));
  }

  function handleFlashResult(result) {
    const card = view.flash.queue[view.flash.idx];
    view.flash.score[result]++;
    view.missed = view.missed.filter((c) => c.de !== card.de);
    if (result === 'missed') view.missed.push(card);
    saveMissed(ctx.userId, view.missed);
    advanceFlash();
  }

  function advanceFlash() {
    view.flash.flipped = false;
    if (view.flash.idx + 1 >= view.flash.queue.length) { view.screen = 'review'; renderReview(); }
    else { view.flash.idx++; renderFlashcards(); }
  }

  // ---- review ---------------------------------------------------------------
  function renderReview() {
    const { got, missed } = view.flash.score;
    el.innerHTML = `
      <div class="page-head"><div class="eyebrow">Flashcards</div><h1>Session review</h1></div>
      <div class="card">
        <div class="grid2">
          <div class="stat"><b style="color:var(--green)">${got}</b><span>Got it</span></div>
          <div class="stat"><b style="color:var(--red)">${missed}</b><span>Missed</span></div>
        </div>
      </div>
      ${view.missed.length ? `
        <div class="card">
          <h2>Keep practicing</h2>
          <div class="missed-list">
            ${view.missed.map((c) => `<div class="missed-row"><span class="de-term">${escapeHtml(c.de)}</span><span class="muted">${escapeHtml(c.en)}</span></div>`).join('')}
          </div>
          <button class="btn" id="retry-missed" style="margin-top:12px;width:100%">Retry missed cards</button>
        </div>` : ''}
      <button class="btn primary" id="back-chat" style="margin-top:14px;width:100%">Back to conversation</button>
    `;
    const rm = el.querySelector('#retry-missed');
    if (rm) rm.onclick = () => startFlashcards(view.missed);
    el.querySelector('#back-chat').onclick = () => { view.screen = 'chat'; renderChat(); };
  }

  rerender();

  // Unmount hook consumed by app.js's navigate() (via exercises.js, which
  // tracks whichever standalone exercise is currently active — see there).
  // Leaving Free Conversation via a top-nav click instead of "Change topic"/
  // "← Exercises" previously left the session row open forever (see
  // IMPROVEMENT_LOG.md 2026-07-16 item 3); this makes sure it still gets
  // closed out in that case.
  return () => endConversationSession();
}
