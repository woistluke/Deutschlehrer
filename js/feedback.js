// feedback.js — a small, reusable "flag an issue" widget dropped onto any
// LLM-generated question/exercise card or tutor chat bubble (sentence
// drills, quiz questions, Verb Conjugation Match rounds, and — since
// 2026-07-20 — curriculum/Free Conversation tutor replies, wired on via
// chatui.js's flagCtx). Deliberately lightweight and out of the way: a
// single muted link that expands into a textarea + submit, logs to the
// content_feedback table (store.js), and confirms inline.
//
// This is intentionally negative-only — there's no "this was a good
// question" counterpart to collect, per Luke, so every row logged here is a
// problem report. See prompts.js (pastIssuesBlock / the pastSentenceIssues,
// pastQuizIssues, pastConvoIssues, and conjugation-match past-issues params)
// for how recent notes get read back into generation as a "known issues to
// avoid" list — that's the whole feedback loop this app has, so treat the
// notes people write here as the only signal shaping future question/reply
// quality.
import * as store from './store.js';

// container: an empty element to render into (put it at the bottom of a
// question card, out of the way of the actual exercise).
// userId: whose feedback this is.
// payload: { contextType, itemType, unitId, unitTitle, prompt, answer } —
// context stored alongside the note so a flagged row is understandable on
// its own later, without needing to reconstruct what question it was.
export function mountFeedbackFlag(container, userId, payload) {
  if (!container) return;
  renderClosed();

  function renderClosed() {
    container.innerHTML = `<button class="fb-flag-btn" type="button">⚑ Something wrong with this?</button>`;
    container.querySelector('.fb-flag-btn').onclick = renderForm;
  }

  function renderForm() {
    container.innerHTML = `
      <div class="fb-flag-form">
        <textarea class="fb-flag-note" rows="2" placeholder="What's wrong? e.g. too advanced for this lesson, answer was vague, grammar looks off…"></textarea>
        <div class="row" style="gap:8px;margin-top:6px">
          <button class="btn primary sm" type="button" id="fb-submit">Send</button>
          <button class="btn ghost sm" type="button" id="fb-cancel">Cancel</button>
        </div>
      </div>
    `;
    const noteEl = container.querySelector('.fb-flag-note');
    noteEl.focus();
    container.querySelector('#fb-cancel').onclick = renderClosed;
    container.querySelector('#fb-submit').onclick = async () => {
      const note = noteEl.value.trim();
      if (!note) return;
      const btn = container.querySelector('#fb-submit');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await store.createContentFeedback(userId, { ...payload, note });
        container.innerHTML = `<span class="fb-flag-done">✓ Thanks — flagged for review.</span>`;
      } catch (e) {
        container.innerHTML = `<span class="fb-flag-error">Couldn't send: ${esc(e.message)}</span>`;
      }
    };
  }
}

function esc(s) { return (s ?? '').toString().replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
