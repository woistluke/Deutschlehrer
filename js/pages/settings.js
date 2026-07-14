// pages/settings.js — standalone settings. Holds the userID field, Supabase
// credentials, provider API keys, and model configuration.
import { DEFAULTS, LS } from '../config.js';
import * as store from '../store.js';

export async function mountSettings(el, ctx) {
  const s = ctx.settings;
  // Open flag-an-issue notes (js/feedback.js -> content_feedback table) — see
  // "Flagged content" card below. Never let this break Settings from loading.
  const allFeedback = await store.allContentFeedback(ctx.userId).catch(() => []);
  const openFeedback = allFeedback
    .filter((f) => (f.status || 'open') === 'open')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  render();

  function render() {
  el.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Settings</div>
      <h1>Settings</h1>
      <p>Your handle separates your progress from other testers. Keys stay in this browser only — they are never sent anywhere except directly to Groq and OpenAI.</p>
    </div>

    <div class="card">
      <h2>Who's learning</h2>
      <label class="field"><span>Your handle <small>— e.g. luke. Switching handles switches whose curriculum you see.</small></span>
        <input id="set-user" value="${esc(ctx.userId)}" placeholder="luke" /></label>
      <button class="btn primary" id="set-user-save">Switch to this handle</button>
    </div>

    <div class="card">
      <h2>Data storage</h2>
      <p class="muted" style="margin-top:0">${ctx.remote
        ? 'Connected to Supabase. Progress syncs across devices.'
        : 'No Supabase keys yet — using this browser\'s local storage. Add keys below to sync across devices.'}</p>
      <label class="field"><span>Supabase project URL</span>
        <input id="set-suburl" value="${esc(s.supabaseUrl)}" placeholder="https://xxxx.supabase.co" /></label>
      <label class="field"><span>Supabase anon key</span>
        <input id="set-subkey" value="${esc(s.supabaseAnonKey)}" placeholder="eyJ..." /></label>
    </div>

    <div class="card">
      <h2>API keys</h2>
      <label class="field"><span>Groq API key <small>— conversation + quiz</small></span>
        <input id="set-groq" type="password" value="${esc(s.groqKey)}" placeholder="gsk_..." /></label>
      <label class="field"><span>OpenAI API key <small>— speech + transcription</small></span>
        <input id="set-openai" type="password" value="${esc(s.openaiKey)}" placeholder="sk-..." /></label>
    </div>

    <div class="card">
      <h2>Models</h2>
      <div class="grid2">
        <label class="field"><span>Tutor model <small>(Groq)</small></span>
          <input id="set-tutormodel" value="${esc(s.tutorModel || DEFAULTS.tutorModel)}" /></label>
        <label class="field"><span>Tutor temperature</span>
          <input id="set-tutortemp" type="number" step="0.1" min="0" max="2" value="${s.tutorTemperature ?? DEFAULTS.tutorTemperature}" /></label>
        <label class="field"><span>Quiz model <small>(separate, stricter)</small></span>
          <input id="set-quizmodel" value="${esc(s.quizModel || DEFAULTS.quizModel)}" /></label>
        <label class="field"><span>Quiz temperature</span>
          <input id="set-quiztemp" type="number" step="0.1" min="0" max="2" value="${s.quizTemperature ?? DEFAULTS.quizTemperature}" /></label>
        <label class="field"><span>TTS voice</span>
          <input id="set-voice" value="${esc(s.ttsVoice || DEFAULTS.ttsVoice)}" /></label>
        <label class="field"><span>TTS model</span>
          <input id="set-ttsmodel" value="${esc(s.ttsModel || DEFAULTS.ttsModel)}" /></label>
      </div>
      <p class="muted" style="font-size:.82rem">Verify current model strings at console.groq.com — provider model names change over time.</p>
    </div>

    <button class="btn primary" id="set-save">Save settings</button>
    <span id="set-status" class="muted" style="margin-left:12px"></span>

    <details class="admin-maintenance" style="margin-top:16px">
      <summary class="btn ghost" style="cursor:pointer;display:inline-block">Maintenance — one-time data migrations</summary>
      <p class="muted" style="font-size:.82rem;margin:8px 0 0">These fix past seed-data issues (already applied to the current seed). Safe and idempotent to re-run, but there's nothing to do here on a routine visit.</p>

    <div class="card" style="margin-top:10px">
      <h2>Admin — curriculum sync</h2>
      <p class="muted" style="margin-top:0">Pushes any sections/units/vocab from the current seed curriculum (<code>seed.js</code>) into existing accounts. Additive only by default — it never deletes anything and never touches a unit's progress (status, mastery). Re-run this any time the seed curriculum changes.</p>
      <label class="row" style="gap:8px;align-items:center;font-weight:normal">
        <input type="checkbox" id="set-sync-refresh" />
        <span>Also refresh objectives / grammar focus / source on units that already exist</span>
      </label>
      <div class="row wrap" style="gap:8px;margin-top:10px">
        <button class="btn primary" id="set-sync-user">Sync this handle (${esc(ctx.userId)})</button>
        <button class="btn danger" id="set-sync-all">Sync ALL users</button>
      </div>
      <pre id="set-sync-report" class="muted" style="margin-top:10px;white-space:pre-wrap"></pre>
    </div>

    <div class="card">
      <h2>Admin — split combined vocab</h2>
      <p class="muted" style="margin-top:0">A one-time cleanup: some seed vocab used to combine multiple words into a single line (e.g. "eins, zwei, drei" or "heute / morgen / gestern"). Those are now separate entries in <code>seed.js</code> — this migrates any matching rows already in an account to the same split, carrying review history forward (seen/correct counts divided evenly across the new rows; mastery/schedule copied to each) rather than resetting it. Safe to re-run — already-split accounts have nothing left to match.</p>
      <div class="row wrap" style="gap:8px">
        <button class="btn primary" id="set-split-user">Split combined vocab (this handle)</button>
        <button class="btn danger" id="set-split-all">Split for ALL users</button>
      </div>
      <pre id="set-split-report" class="muted" style="margin-top:10px;white-space:pre-wrap"></pre>
    </div>

    <div class="card">
      <h2>Admin — merge duplicate vocab</h2>
      <p class="muted" style="margin-top:0">A handful of vocab words ended up duplicated verbatim across two different units in the seed curriculum (fixed in <code>seed.js</code>, but that alone doesn't touch accounts already seeded from the old version). This finds any of those in an existing account and merges each pair into one row — summing review counts, keeping the better mastery/schedule state, and removing the redundant row — instead of leaving two untracked-together entries for what's really one word. Safe to re-run.</p>
      <div class="row wrap" style="gap:8px">
        <button class="btn primary" id="set-merge-user">Merge duplicate vocab (this handle)</button>
        <button class="btn danger" id="set-merge-all">Merge for ALL users</button>
      </div>
      <pre id="set-merge-report" class="muted" style="margin-top:10px;white-space:pre-wrap"></pre>
    </div>

    <div class="card">
      <h2>Flagged content ${openFeedback.length ? `(${openFeedback.length} open)` : ''}</h2>
      <p class="muted" style="margin-top:0">Questions/sentences you flagged with "⚑ Something wrong with this?" — these get read back into future generation as issues to avoid (see <code>prompts.js</code>) until marked resolved here. Mark one resolved once its underlying problem is actually fixed, so it stops being cited indefinitely.</p>
      ${openFeedback.length ? `<div id="fb-list">${openFeedback.map(feedbackRow).join('')}</div>`
        : `<p class="muted" style="font-size:.85rem">Nothing open — clean slate.</p>`}
    </div>
    </details>
  `;

  el.querySelectorAll('[data-resolve-fb]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-resolve-fb');
      btn.disabled = true; btn.textContent = 'Resolving…';
      try {
        await store.resolveContentFeedback(id);
        const i = openFeedback.findIndex((f) => f.content_feedback_id === id);
        if (i >= 0) openFeedback.splice(i, 1);
        render();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Mark resolved';
        alert('Could not resolve: ' + e.message);
      }
    };
  });

  el.querySelector('#set-user-save').onclick = async () => {
    const u = el.querySelector('#set-user').value.trim().toLowerCase();
    if (!u) return;
    await ctx.switchUser(u);
  };

  el.querySelector('#set-save').onclick = async () => {
    const next = {
      ...s,
      supabaseUrl: val('#set-suburl'), supabaseAnonKey: val('#set-subkey'),
      groqKey: val('#set-groq'), openaiKey: val('#set-openai'),
      tutorModel: val('#set-tutormodel'), tutorTemperature: numVal('#set-tutortemp'),
      quizModel: val('#set-quizmodel'), quizTemperature: numVal('#set-quiztemp'),
      ttsVoice: val('#set-voice'), ttsModel: val('#set-ttsmodel'),
      groqBase: s.groqBase || DEFAULTS.groqBase, openaiBase: s.openaiBase || DEFAULTS.openaiBase,
      transcribeModel: s.transcribeModel || DEFAULTS.transcribeModel,
    };
    localStorage.setItem(LS.settings, JSON.stringify(next));
    el.querySelector('#set-status').textContent = 'Saved. Reloading…';
    setTimeout(() => location.reload(), 500);
  };

  el.querySelector('#set-sync-user').onclick = async () => {
    const btn = el.querySelector('#set-sync-user');
    const out = el.querySelector('#set-sync-report');
    const refreshMetadata = el.querySelector('#set-sync-refresh').checked;
    btn.disabled = true; out.textContent = `Syncing ${ctx.userId}…`;
    try {
      const r = await store.syncCurriculumToSeed(ctx.userId, { refreshMetadata });
      out.textContent = `${ctx.userId}: +${r.sectionsAdded} sections, +${r.unitsAdded} units, +${r.vocabAdded} vocab` +
        (refreshMetadata ? `, refreshed ${r.sectionsUpdated} section(s) / ${r.unitsUpdated} unit(s)` : '');
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    } finally { btn.disabled = false; }
  };

  el.querySelector('#set-sync-all').onclick = async () => {
    if (!confirm('Sync the seed curriculum into EVERY user account? This only adds missing content (and optionally refreshes descriptions) — it never deletes anything. Proceed?')) return;
    const btn = el.querySelector('#set-sync-all');
    const out = el.querySelector('#set-sync-report');
    const refreshMetadata = el.querySelector('#set-sync-refresh').checked;
    btn.disabled = true; out.textContent = 'Syncing all users…';
    try {
      const results = await store.syncCurriculumToSeedForAllUsers({ refreshMetadata });
      out.textContent = results.map((r) =>
        `${r.userId}: +${r.sectionsAdded} sections, +${r.unitsAdded} units, +${r.vocabAdded} vocab`).join('\n');
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    } finally { btn.disabled = false; }
  };

  el.querySelector('#set-split-user').onclick = async () => {
    const btn = el.querySelector('#set-split-user');
    const out = el.querySelector('#set-split-report');
    btn.disabled = true; out.textContent = `Splitting for ${ctx.userId}…`;
    try {
      const r = await store.splitCombinedVocab(ctx.userId);
      out.textContent = r.rowsSplit
        ? `${ctx.userId}: split ${r.rowsSplit} combined row(s) into ${r.rowsCreated} individual entries.`
        : `${ctx.userId}: nothing to split — already up to date.`;
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    } finally { btn.disabled = false; }
  };

  el.querySelector('#set-split-all').onclick = async () => {
    if (!confirm('Split combined vocab entries for EVERY user account? This carries each row\'s review history forward to the new split entries and removes the old combined row. Proceed?')) return;
    const btn = el.querySelector('#set-split-all');
    const out = el.querySelector('#set-split-report');
    btn.disabled = true; out.textContent = 'Splitting for all users…';
    try {
      const results = await store.splitCombinedVocabForAllUsers();
      out.textContent = results.map((r) =>
        r.rowsSplit ? `${r.userId}: split ${r.rowsSplit} row(s) into ${r.rowsCreated} entries.` : `${r.userId}: nothing to split.`
      ).join('\n');
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    } finally { btn.disabled = false; }
  };

  el.querySelector('#set-merge-user').onclick = async () => {
    const btn = el.querySelector('#set-merge-user');
    const out = el.querySelector('#set-merge-report');
    btn.disabled = true; out.textContent = `Merging for ${ctx.userId}…`;
    try {
      const r = await store.mergeDuplicateVocab(ctx.userId);
      out.textContent = r.groupsMerged
        ? `${ctx.userId}: merged ${r.groupsMerged} duplicate group(s), removed ${r.rowsRemoved} redundant row(s).`
        : `${ctx.userId}: no duplicates found — already clean.`;
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    } finally { btn.disabled = false; }
  };

  el.querySelector('#set-merge-all').onclick = async () => {
    if (!confirm('Merge duplicate vocab for EVERY user account? This sums each duplicate\'s review history into one surviving row and removes the rest. Proceed?')) return;
    const btn = el.querySelector('#set-merge-all');
    const out = el.querySelector('#set-merge-report');
    btn.disabled = true; out.textContent = 'Merging for all users…';
    try {
      const results = await store.mergeDuplicateVocabForAllUsers();
      out.textContent = results.map((r) =>
        r.groupsMerged ? `${r.userId}: merged ${r.groupsMerged} group(s), removed ${r.rowsRemoved} row(s).` : `${r.userId}: no duplicates found.`
      ).join('\n');
    } catch (e) {
      out.textContent = 'Error: ' + e.message;
    } finally { btn.disabled = false; }
  };

  function val(sel) { return el.querySelector(sel).value.trim(); }
  function numVal(sel) { return parseFloat(el.querySelector(sel).value); }
  } // end render()
}

function feedbackRow(f) {
  const when = new Date(f.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const ctxLabel = { sentence_drill: 'Sentence drill', quiz: 'Quiz', conjugation_match: 'Conjugation Match' }[f.context_type] || f.context_type;
  return `<div class="row spread" style="padding:8px 0;border-bottom:1px solid var(--line);align-items:flex-start">
    <div style="flex:1">
      <div style="font-size:.8rem" class="muted">${esc(ctxLabel)}${f.unit_title ? ` · ${esc(f.unit_title)}` : ''} · ${when}</div>
      ${f.prompt_text ? `<div style="margin:2px 0"><b>${esc(f.prompt_text)}</b></div>` : ''}
      <div style="font-size:.88rem">${esc(f.note)}</div>
    </div>
    <button class="btn ghost sm" data-resolve-fb="${esc(f.content_feedback_id)}" style="flex-shrink:0;margin-left:10px">Mark resolved</button>
  </div>`;
}

function esc(v) { return (v ?? '').toString().replace(/"/g, '&quot;'); }
