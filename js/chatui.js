// chatui.js — the rich structured conversation component, shared by the
// Free Conversation exercise and the curriculum conversation phase. Ports the original
// single-file app's features: reply + translation toggle, inline corrections,
// grammar/culture tip, vocab chips, per-line TTS, and mic transcription.
import { tutorStructured, speak, transcribe } from './ai.js';
import { mountFeedbackFlag } from './feedback.js';

export function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Create a rich chat inside `el`.
//   getSystemPrompt : () => string   (read fresh each turn so level/topic edits apply)
//   onVocab         : (vocabList) => void   notified when collected vocab changes
//   placeholder     : input placeholder
// Returns { open, getVocab, getHistory }.
// initialMessages: restore a previously-collected conversation (e.g. when the
// UI needs to tear down and recreate the DOM node — such as leaving/returning
// from the flashcards screen — without losing the chat so far or re-sending
// an opening greeting).
// flagCtx: { userId, contextType, unitId, unitTitle } — when provided, tutor
// bubbles get a "flag an issue" affordance (see feedback.js), and flagged
// notes get read back into future generation via prompts.js's pastIssuesBlock
// (buildUnitConvoPrompt/buildFreeConvoPrompt's pastConvoIssues/pastIssues).
// Previously the conversation surfaces had no feedback loop at all, unlike
// sentence_drill/quiz/conjugation_match (see IMPROVEMENT_LOG.md 2026-07-20
// item 1). Omitted entirely (null) leaves bubbles exactly as before.
export function createRichChat(el, { getSystemPrompt, onVocab = () => {}, onCorrections = () => {}, placeholder = 'Schreib auf Deutsch…', initialMessages = null, flagCtx = null }) {
  let messages = initialMessages ? initialMessages.slice() : [];   // rich: {role, content, translation, corrections, tip, vocab}
  let vocab = [];      // de-duped collected vocab [{de,en}]
  let loading = false;
  let recorder = null, chunks = [];

  el.innerHTML = `
    <div class="chat rich" data-chat></div>
    <div class="composer">
      <button class="btn mic" data-mic title="Speak in German">🎙</button>
      <input data-say placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      <button class="btn primary" data-send>Send</button>
    </div>
    <p class="muted rc-status" data-status></p>
  `;
  const chatEl = el.querySelector('[data-chat]');
  const sayEl = el.querySelector('[data-say]');
  el.querySelector('[data-send]').onclick = send;
  el.querySelector('[data-mic]').onclick = toggleMic;
  sayEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  function status(t) { el.querySelector('[data-status]').textContent = t || ''; }
  function modelHistory(extraSeed) {
    const h = messages.map((m) => ({ role: m.role === 'tutor' ? 'assistant' : 'user', content: m.content }));
    if (extraSeed) h.push({ role: 'user', content: extraSeed });
    return h;
  }
  function collectVocab() {
    const all = messages.flatMap((m) => m.vocab || []);
    vocab = [...new Map(all.map((v) => [v.de, v])).values()];
    onVocab(vocab);
  }

  async function turn(seed) {
    if (loading) return;
    loading = true; setBusy(true); status('Denke nach…');
    try {
      const p = await tutorStructured(getSystemPrompt(), modelHistory(seed));
      messages.push({ role: 'tutor', content: p.reply, translation: p.translation, corrections: p.corrections, tip: p.tip, vocab: p.vocab });
      collectVocab();
      paint();
      if (p.reply) say(p.reply);
      // Notify the host page of this turn's corrections (fresh per-turn, not
      // deduped/aggregated across the conversation the way collectVocab()
      // does for vocab chips — each correction is a distinct mistake
      // instance worth its own record). Only the curriculum conversation
      // phase currently wires this up (see runner.js) to feed SRS/error
      // trend; Free Conversation leaves it as the no-op default since it's
      // explicitly no-scoring practice.
      if (p.corrections && p.corrections.length) onCorrections(p.corrections);
    } catch (e) {
      messages.push({ role: 'tutor', content: `⚠️ ${e.message}`, corrections: [], vocab: [] });
      paint();
    } finally { loading = false; setBusy(false); status(''); }
  }

  async function send() {
    const t = sayEl.value.trim(); if (!t || loading) return;
    sayEl.value = '';
    messages.push({ role: 'user', content: t });
    paint();
    await turn();
  }

  function setBusy(b) {
    el.querySelector('[data-send]').disabled = b;
    sayEl.disabled = b;
  }

  async function toggleMic() {
    const btn = el.querySelector('[data-mic]');
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream); chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        btn.textContent = '🎙'; btn.classList.remove('recording'); status('Transkribiere…');
        try { sayEl.value = await transcribe(new Blob(chunks, { type: 'audio/webm' })); status(''); sayEl.focus(); }
        catch (e) { status(e.message); }
      };
      recorder.start(); btn.textContent = '⏺'; btn.classList.add('recording');
      status('Höre zu… (Mikrofon erneut tippen zum Stoppen)');
    } catch (e) { status('Mikrofon nicht verfügbar: ' + e.message); }
  }

  // speak() hands back a fresh object URL per call (see ai.js) — revoke it
  // once this specific clip finishes (or errors) so long sessions with
  // auto-speak-every-turn don't accumulate unreleased blob URLs/audio
  // buffers for the life of the tab.
  async function say(text) {
    try {
      const url = await speak(text);
      const audio = new Audio(url);
      const cleanup = () => URL.revokeObjectURL(url);
      audio.addEventListener('ended', cleanup, { once: true });
      audio.addEventListener('error', cleanup, { once: true });
      await audio.play();
    } catch (e) { status(e.message); }
  }

  function paint() {
    chatEl.innerHTML = messages.map((m, i) => renderBubble(m, i, !!flagCtx)).join('');
    chatEl.querySelectorAll('[data-speak]').forEach((b) => b.onclick = () => say(b.getAttribute('data-speak')));
    chatEl.querySelectorAll('[data-trans]').forEach((b) => b.onclick = () => {
      const box = chatEl.querySelector('#' + b.getAttribute('data-trans'));
      if (!box) return;
      const hidden = box.classList.toggle('hidden');
      b.textContent = hidden ? 'show translation' : 'hide translation';
    });
    // Wire each tutor bubble's flag slot (see the flagCtx param above). Only
    // real tutor replies get one -- the "⚠️ <error message>" fallback bubble
    // (see turn()'s catch below) isn't generated content, so there's nothing
    // to flag. "prompt" context is the learner's own preceding message when
    // there is one (empty for an opening greeting), "answer" is the tutor's
    // reply text that's actually being flagged.
    if (flagCtx) {
      chatEl.querySelectorAll('[data-flag-slot]').forEach((slot) => {
        const i = Number(slot.getAttribute('data-flag-slot'));
        const m = messages[i];
        if (!m || m.role !== 'tutor') return;
        let prevUser = '';
        for (let j = i - 1; j >= 0; j--) { if (messages[j].role === 'user') { prevUser = messages[j].content; break; } }
        // alreadyFlagged/onFlagged: paint() fully re-mounts every bubble's
        // flag slot from scratch on every turn (see the innerHTML rebuild
        // above), so without remembering flagged state on the message
        // itself, an already-flagged bubble would silently revert to the
        // unflagged "⚑" button the moment the conversation continued,
        // inviting a duplicate content_feedback row if flagged again — see
        // IMPROVEMENT_LOG.md 2026-08-22 item 2.
        mountFeedbackFlag(slot, flagCtx.userId, {
          contextType: flagCtx.contextType,
          itemType: 'conversation',
          unitId: flagCtx.unitId || null,
          unitTitle: flagCtx.unitTitle || null,
          prompt: prevUser,
          answer: m.content,
        }, { alreadyFlagged: !!m.flaggedAt, onFlagged: () => { m.flaggedAt = Date.now(); } });
      });
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // If we're restoring a prior conversation, render it immediately and seed
  // `vocab` from it so future turns dedupe correctly against what's already
  // been collected — no network call, no fresh greeting.
  if (messages.length) { collectVocab(); paint(); }

  return {
    open: (seed) => turn(seed || 'Start the conversation with a natural German greeting or opening question.'),
    hasHistory: () => messages.length > 0,
    getVocab: () => vocab,
    getHistory: () => messages,
  };
}

let trId = 0;
function renderBubble(m, i, includeFlag) {
  if (m.role === 'user') {
    return `<div class="turn user"><div class="bubble user">${escapeHtml(m.content)}</div></div>`;
  }
  // The "⚠️ <error message>" fallback bubble (see turn()'s catch) isn't
  // generated content -- nothing to flag, so it never gets a flag slot even
  // when includeFlag is true.
  const isErrorBubble = m.content && m.content.startsWith('⚠️');
  let h = `<div class="turn tutor">`;
  h += `<div class="bubble tutor">${escapeHtml(m.content)} <span class="speak" data-speak="${escapeHtml(m.content)}" title="Hear it">🔊</span></div>`;
  if (m.corrections && m.corrections.length) {
    h += `<div class="corrections">` + m.corrections.map((c) =>
      `<div class="corr-row"><span class="corr-wrong">${escapeHtml(c.wrong)}</span> → <span class="corr-right">${escapeHtml(c.right)}</span>${c.note ? `<span class="corr-note"> — ${escapeHtml(c.note)}</span>` : ''}</div>`
    ).join('') + `</div>`;
  }
  if (m.tip) h += `<div class="tip">💡 ${escapeHtml(m.tip)}</div>`;
  if (m.translation) {
    const id = 'tr' + (trId++);
    h += `<div class="trans-wrap"><button class="trans-toggle" data-trans="${id}">show translation</button><div id="${id}" class="translation hidden">${escapeHtml(m.translation)}</div></div>`;
  }
  if (m.vocab && m.vocab.length) {
    h += `<div class="vocab-chips">` + m.vocab.map((v) =>
      `<span class="vchip"><b>${escapeHtml(v.de)}</b> — ${escapeHtml(v.en)}</span>`
    ).join('') + `</div>`;
  }
  if (includeFlag && !isErrorBubble) h += `<div class="fb-slot" data-flag-slot="${i}" style="margin-top:6px"></div>`;
  h += `</div>`;
  return h;
}
