// prompts.js — assembles system prompts at runtime from curriculum state.
// The tutor prompts are conversational and encouraging; the quiz/grader prompts
// are a separate, stricter configuration. They never share a configuration.

// Map vocab/progress rows into compact lines for the prompt.
function vocabLines(vocab) {
  return vocab.map((v) => `- ${v.german} — ${v.english}${v.notes ? `  (note: ${v.notes})` : ''}`).join('\n');
}
function reviewLines(items, vocabById) {
  return items.map((p) => {
    const v = vocabById[p.item_id];
    const label = v ? `${v.german} — ${v.english}` : p.item_id;
    return `- ${label} (mastery ${Math.round((p.mastery_score || 0) * 100)}%)`;
  }).join('\n');
}
function weakLines(items, vocabById) {
  return items.map((p) => {
    const v = vocabById[p.item_id];
    const label = v ? `${v.german} — ${v.english}` : p.item_id;
    const errs = (p.known_errors || []).join('; ');
    return `- ${label}${errs ? ` — recurring issue: ${errs}` : ''}`;
  }).join('\n');
}

// Learner-flagged problems with past generated content (js/feedback.js +
// store.js's content_feedback table) fed back in as things to specifically
// avoid repeating. This is the app's only content-quality feedback loop —
// there's no positive counterpart being collected, so every note here is a
// real complaint, not a style example. Used by buildSentencePrompt,
// buildQuizPrompt's 'generate' stage, and buildConjugationPrompt.
function pastIssuesBlock(issues) {
  if (!issues || !issues.length) return '';
  return `\nLEARNER-FLAGGED ISSUES FROM PAST QUESTIONS — real feedback, not examples to imitate. Do not repeat these specific problems (too advanced for the level, vague/unclear, wrong, etc.):\n${issues.map((n) => `- ${n}`).join('\n')}\n`;
}

// Cross-session error-type trend (see store.recentErrorTrend) — distinct
// from a single item's known_errors: this is "what's been going wrong
// lately, in general" rather than "what's wrong with this one word." Used
// to bias fresh sentence/quiz/conversation generation toward exercising a
// recurring weak spot even when the specific words involved don't
// individually look shaky yet.
function errorTrendBlock(trend) {
  if (!trend || !trend.length) return '';
  return `\nRECENT ERROR TREND — across Luke's last several sessions, these error types have come up repeatedly: ${trend.map((t) => `${t.type} (${t.count}x)`).join(', ')}. Where it fits naturally, lean at least one item toward exercising this.\n`;
}

// The structured conversation format — shared by the free-practice tab and the
// curriculum conversation phase. The tutor model returns JSON the UI renders as
// reply + translation + inline corrections + tip + vocab chips.
const STRUCTURED_FORMAT = `Respond ONLY with valid JSON (no markdown, no code fences) matching this exact shape:
{
  "reply": "<your German response>",
  "translation": "<full English translation of your reply>",
  "corrections": [{ "wrong": "<what the learner wrote>", "right": "<corrected form>", "note": "<brief grammar note>" }],
  "tip": "<one short cultural or grammar insight, or empty string>",
  "vocab": [{ "de": "<German word/phrase from your reply>", "en": "<English meaning>" }]
}
Rules:
- reply: natural German only; always end with a question to keep the conversation flowing.
- corrections: only real errors from the learner's last message (max 3); empty array if they were correct.
- vocab: 1–3 useful words drawn from YOUR reply.
- tip: only when genuinely useful, otherwise "".`;

// Free-practice conversation (the Free Conversation exercise, in the Exercises tab). Level + topic chosen by
// the learner; not tied to the curriculum.
export function buildFreeConvoPrompt({ level = 'A2', topic = 'Free Conversation' } = {}) {
  return `You are an immersive German conversation partner for a ${level}-level learner. Topic: "${topic}".
Keep your German natural for ${level}: at A1/A2 use simple words and short sentences; at B2/C1 complex grammar and idioms are welcome.
Gently correct the learner's real mistakes. Pay attention to umlaut spelling (e.g. möchte vs mochte) and the wo/woher/wohin distinction.

${STRUCTURED_FORMAT}`;
}

// Sections' `notes` field carries a CEFR sub-level tag authored in seed.js
// (e.g. "A1.1 -- the absolute basics...", "B2.1 -- passive voice, formal
// writing...", "A1.3 -> A2.1 -- describing your home..."). Extract the CEFR
// band(s) mentioned and take the LAST one — the band the section is heading
// toward — so a section spanning a range (e.g. "A1.3 -> A2.1") reads as the
// more advanced end, matching "keep the German at or slightly above the
// learner's level." Falls back to null when a section has no notes (e.g.
// the due-review pseudo-unit, which has no real section behind it).
const CEFR_BAND_RE = /\b(A1|A2|B1|B2|C1|C2)\b/g;
function sectionLevel(sectionNotes) {
  if (!sectionNotes) return null;
  const matches = [...sectionNotes.matchAll(CEFR_BAND_RE)].map((m) => m[1]);
  return matches.length ? matches[matches.length - 1] : null;
}

// Curriculum conversation phase — structured, like the free tab but grounded in
// the active unit, plus review items from previous lessons, known weak points,
// and unmastered stragglers from earlier units (priorWeak — see
// store.getUnmasteredFromPriorUnits). priorWeak was previously only threaded
// into buildSentencePrompt/buildQuizPrompt, leaving the conversation phase —
// arguably the best venue to organically reuse an older shaky word in a
// natural sentence rather than a forced drill — blind to this pool entirely
// (see IMPROVEMENT_LOG.md 2026-07-16 item 2).
// ctx = { unit, section, sectionTitle, reviewItems, weakPoints, priorWeak, vocabById, mode }
export function buildUnitConvoPrompt(ctx) {
  const { unit, section, sectionTitle, reviewItems = [], weakPoints = [], priorWeak = [], vocabById = {}, mode = 'curriculum', errorTrend = [] } = ctx;
  const objectives = (unit?.objectives || []).join('; ');
  const grammar = (unit?.grammar_focus || []).join('; ');
  // Grounded in THIS unit's actual section, not a fixed assumption — a
  // hardcoded "A1-A2" here previously stayed put through the whole 40-unit
  // curriculum, including late units whose grammar_focus is clearly B2/C1
  // (passive voice, Konjunktiv I/II, indirect speech, advanced connectors),
  // telling the tutor to keep things simple in exactly the phase meant to
  // put that advanced material to use in real conversation.
  const level = sectionLevel(section?.notes) || 'A1–A2';

  return `You are a warm, encouraging German conversation tutor for an adult learner (Luke), currently working at roughly ${level} level based on where this unit sits in the curriculum. You speak mostly in simple German, dropping into English only inside the "translation"/"tip" fields. Keep your German at or just slightly above ${level} — matching THIS unit's own grammar focus and vocabulary below, not a flatter beginner default.

SESSION MODE: ${mode}
CURRENT SECTION: ${sectionTitle || '—'}
CURRENT UNIT: ${unit?.title || '—'}
OBJECTIVES FOR THIS UNIT: ${objectives || '—'}
GRAMMAR FOCUS: ${grammar || '—'}

VOCABULARY THE LEARNER JUST MATCHED AND DRILLED THIS LESSON (build the conversation around these so they get used in context):
${vocabLines(unit?.vocab || []) || '- (none)'}

REVIEW ITEMS FROM PREVIOUS LESSONS (weave these in naturally so they get reused, without announcing them):
${reviewLines(reviewItems, vocabById) || '- (none)'}

KNOWN WEAK POINTS TO DELIBERATELY PROBE (Luke has struggled with these — create natural openings to test them):
${weakLines(weakPoints, vocabById) || '- (none)'}

STRAGGLERS FROM EARLIER UNITS (not yet mastered — look for a natural opening to use at least one or two of these too, so old material keeps getting closing-the-gap reps, not just this unit's new words):
${vocabLines(priorWeak) || '- (none)'}
${errorTrendBlock(errorTrend)}
HOW TO TEACH:
- Hold a real back-and-forth conversation on the unit's topic. Ask questions; wait for answers.
- Combine this lesson's new vocabulary with concepts from earlier lessons (the review items and stragglers above).
- Correct real errors inline via the "corrections" field; keep "reply" flowing.
- Pay special attention to umlaut spelling (möchte vs mochte) and the wo/woher/wohin distinction — persistent issues.
- Keep turns short.

${STRUCTURED_FORMAT}

Begin now with a natural greeting in German appropriate to the unit.`;
}

// Single-sentence practice generator (lesson phase 2). Produces ONE-sentence
// drills mixing English→German, German→English, and respond-in-German.
// weakPoints/reviewItems were previously only threaded into buildUnitConvoPrompt
// and buildQuizPrompt — this generator is called with the same sessionCtx as
// both of those (it already carries weakPoints/reviewItems/vocabById), but
// only ever destructured unit/priorWeak/pastSentenceIssues/errorTrend from it,
// so one of the app's two graded phases never actually weighted Luke's known
// weak points or due-for-review items the way the quiz phase does (see
// IMPROVEMENT_LOG.md 2026-07-17 item 2). Also threads unit.objectives — every
// seed unit authors this alongside grammar_focus as the lesson's communicative
// goal, but until now only the conversation prompt ever saw it.
export function buildSentencePrompt(ctx) {
  const { unit, priorWeak = [], weakPoints = [], reviewItems = [], vocabById = {}, pastSentenceIssues = [], errorTrend = [] } = ctx;
  const pool = (unit?.vocab || []).map((v) => `${v.german} — ${v.english}${v.notes ? `  (note: ${v.notes})` : ''}`);
  const priorPool = priorWeak.map((v) => `${v.german} — ${v.english}${v.notes ? `  (note: ${v.notes})` : ''}`);
  const grammarFocus = (unit?.grammar_focus || []).join('; ');
  const objectives = (unit?.objectives || []).join('; ');
  const weakLinesText = weakLines(weakPoints, vocabById);
  const reviewLinesText = reviewLines(reviewItems, vocabById);
  return `You are a German single-sentence drill generator. Using the vocabulary below, create exactly 5 SINGLE-SENTENCE practice items. Each item is ONE sentence only — never a multi-turn conversation.

Use these five types:
- "en_to_de": give a short English sentence; the learner translates it into German.
- "de_to_en": give a short German sentence; the learner translates it into English.
- "respond_de": ask one simple question in German; the learner answers in a single German sentence.
- "word_order": "prompt" is a short English gloss of what to say; "answer" is the single correct, natural German sentence for it. The learner is shown that sentence's words scrambled and taps them back into the right order — so pick a sentence with only one natural word order (no cases where two orderings are equally correct).
- "listen_type": a listening-dictation item. "answer" is a natural, complete German sentence using this lesson's vocabulary — this is the sentence that gets read aloud to the learner, who then types what they heard. "prompt" is just a short instruction (e.g. "Listen and type what you hear") since the UI never shows the German text. Pick an unambiguous sentence — avoid homophones or wording where more than one spelling would sound identical when spoken.
Make exactly ONE of the 5 items type "word_order" and exactly ONE type "listen_type" (this unit's grammar focus below is a good source for both, when there is one); mix the remaining three roughly evenly across en_to_de/de_to_en/respond_de.

Use the lesson vocabulary wherever it fits. Keep the language at the level implied by this unit's grammar focus and vocabulary below — don't default to simple present-tense sentences if the grammar focus below calls for something else (a past-tense unit's drills should be in the past tense, etc).
${pastIssuesBlock(pastSentenceIssues)}${errorTrendBlock(errorTrend)}${objectives ? `
THIS UNIT'S OBJECTIVES (the communicative goal — draw at least one item toward actually accomplishing this, not just its vocabulary/grammar in isolation):
${objectives}
` : ''}${grammarFocus ? `
THIS UNIT'S GRAMMAR FOCUS — build AT LEAST 1-2 of the 5 items to specifically exercise this, not just the vocabulary (e.g. a Perfekt-tense focus should produce a Perfekt-tense sentence; a word-order focus should require the correct word order to answer correctly):
${grammarFocus}
` : ''}${priorPool.length ? `
PRIORITY REVIEW — words from EARLIER units the learner hasn't mastered yet. Spend at least ${Math.min(2, priorPool.length)} of the 5 items on these before drawing more from this lesson's vocabulary:
${priorPool.map((p) => `- ${p}`).join('\n')}
` : ''}${weakLinesText ? `
KNOWN WEAK POINTS — Luke has struggled with these; work at least one into an item where it fits naturally:
${weakLinesText}
` : ''}${reviewLinesText ? `
DUE FOR REVIEW — items due to resurface; prefer these over brand-new material when an item's vocabulary choice is otherwise open:
${reviewLinesText}
` : ''}
Each of the 5 items is fully independent: its "answer" must be the direct, faithful
solution to that SAME item's "prompt" only — never borrow wording, vocabulary, or
sentence fragments from a different item in this batch. Each "prompt" and each
"answer" is exactly one complete sentence (for respond_de, one natural reply) — do
not merge two sentences together into one field. Never produce a "fill_blank" item
in this phase — only en_to_de, de_to_en, respond_de, word_order, or listen_type.

THIS LESSON'S VOCABULARY:
${pool.map((p) => `- ${p}`).join('\n') || '- (none)'}

Respond with STRICT JSON only, no prose, no markdown fences:
{"items":[{"id":"s1","type":"en_to_de|de_to_en|respond_de|word_order|listen_type","prompt":"<what the learner sees>","answer":"<the intended/model answer — for word_order, the single correctly-ordered German sentence; for listen_type, the sentence to be read aloud>","item_label":"<the vocab item this maps to, or empty>"}]}`;
}

// Dictation-specific grader — deliberately NOT the lenient "possible
// solution" grader (GRADER_PROMPT) below, because dictation tests whether
// the learner correctly HEARD the sentence: a paraphrase that means the
// same thing but isn't what was actually said should count as wrong here,
// where GRADER_PROMPT would happily accept it.
export const DICTATION_GRADER_PROMPT = `You are grading a German LISTENING DICTATION exercise: the learner heard one German sentence read aloud and typed what they heard. Compare their transcription to the source sentence.

Mark it correct only if the transcription captures the SAME WORDS as the source sentence (minor casing/punctuation differences and a single obvious typo are fine). Mark it incorrect if a word is wrong, missing, or added, or an umlaut is dropped/misplaced (ö/ü/ä matter) — even if the resulting sentence would still be grammatical German on its own, since this exercise is testing what was actually heard, not general German ability.

Respond with STRICT JSON only, no prose, no markdown fences:
{"correct":true|false,"feedback":"<one short line, naming the specific word(s) that differed if incorrect>","error_type":"spelling|umlaut|vocab|grammar|none","intended":"<the source sentence, only when the transcription differs from it, else empty>"}`;

// Renders a vocab-pool line with its usage/grammar note kept intact (e.g.
// "Triggers normal verb-second order, unlike weil.") — dropping this for the
// quiz pool specifically (as an earlier version of this file did) starved
// the quiz generator of exactly the hint it needs to write a grammatically
// sound fill_blank around that item.
function poolLine(v) {
  return `${v.german} — ${v.english}${v.notes ? `  (note: ${v.notes})` : ''}`;
}

// Quiz/grader prompt. stage 'generate' produces questions; stage 'grade'
// evaluates an answer leniently — see below.
export function buildQuizPrompt(ctx, stage) {
  const { unit, reviewItems = [], weakPoints = [], priorWeak = [], vocabById = {}, pastQuizIssues = [], errorTrend = [] } = ctx;
  const priorLines = priorWeak.map(poolLine);
  const restLines = [
    ...(unit?.vocab || []).map(poolLine),
    ...reviewItems.map((p) => { const v = vocabById[p.item_id]; return v ? poolLine(v) : null; }).filter(Boolean),
    // Weak points additionally carry *why* they're weak (known_errors, e.g.
    // "umlaut") when available — that's more useful to the generator than a
    // generic vocab note, so it takes priority over v.notes when both exist.
    ...weakPoints.map((p) => {
      const v = vocabById[p.item_id]; if (!v) return null;
      const errs = (p.known_errors || []).join('; ');
      return errs ? `${v.german} — ${v.english}  (recurring issue: ${errs})` : poolLine(v);
    }).filter(Boolean),
  ].filter((line, i, arr) => arr.indexOf(line) === i && !priorLines.includes(line)); // de-dupe, and keep out of "rest" whatever's already in priority
  const grammarFocus = (unit?.grammar_focus || []).join('; ');
  // Every seed unit authors objectives alongside grammar_focus as the
  // lesson's communicative goal — previously threaded into buildUnitConvoPrompt
  // only, leaving the quiz generator blind to what the lesson is actually
  // trying to accomplish beyond its grammar point (see IMPROVEMENT_LOG.md
  // 2026-07-17 item 2).
  const objectives = (unit?.objectives || []).join('; ');

  if (stage === 'generate') {
    return `You are a German quiz generator. Build a short mixed quiz (5–7 items) from the item pool below. Mix directions: some German→English, some English→German, at least one fill-in-the-blank sentence, and at least one that targets a known weak point.
${pastIssuesBlock(pastQuizIssues)}${errorTrendBlock(errorTrend)}${objectives ? `
THIS UNIT'S OBJECTIVES (the communicative goal — where it fits, favor questions that actually test accomplishing this, not just isolated vocabulary recall):
${objectives}
` : ''}${grammarFocus ? `
THIS UNIT'S GRAMMAR FOCUS — make sure AT LEAST 1-2 questions specifically test this, not just vocabulary recall (e.g. a Perfekt-tense focus should have a question that requires the correct Perfekt form; a word-order focus should require the correct order to answer correctly):
${grammarFocus}
` : ''}${priorLines.length ? `
PRIORITY: allocate AT LEAST half of this quiz's questions to the "PRIORITY REVIEW" pool below — words from EARLIER units the learner hasn't mastered yet — before drawing from the rest of the pool. The goal is closing the gap on older units, not just drilling the current one.
` : ''}
Every question is fully independent: its "answer" must be the direct, faithful
solution to that SAME question's "prompt" only — never borrow wording or content
from a different question in this batch.

For any "fill_blank" question specifically: pick exactly ONE pool item — the blank
MUST BE that pool item's own German word/phrase itself, not some other word in the
sentence. Write "prompt" as one complete German sentence containing that pool item,
with THAT pool item (and only that pool item) replaced by a blank shown as exactly
"____" (four underscores) — the rest of the sentence stays fully written out. Never
blank a proper noun, number, or other incidental word that isn't the pool item being
tested — the learner must be filling in the vocabulary they're studying, not guessing
an arbitrary detail (e.g. for the pool item "kommen aus — to come from", a sentence
like "Ich ____ Berlin" is correct; "Ich komme aus ____" is wrong because it blanks
the city, not the vocabulary item).

The blank and the "answer" field must match EXACTLY, word for word: "answer" is the
literal text removed from "prompt" to create the blank — nothing more, nothing less.
If the pool item is a multi-word phrase (e.g. "kommen aus"), EVERY word of that phrase
must sit inside the single blank, contiguously — never leave part of the phrase spelled
out in the sentence while the rest goes into "answer" (wrong: prompt "Ich ____ aus
Berlin" with answer "komme aus" — "aus" is visible in the prompt AND in the answer,
so the learner can't tell the blank needs it too; right: prompt "Ich ____ Berlin" with
answer "komme aus"). Before finalizing each fill_blank question, check that replacing
"____" in "prompt" with "answer" reproduces the exact original sentence with no leftover
or duplicated words.

${priorLines.length ? `PRIORITY REVIEW (earlier units, not yet mastered):
${priorLines.map((p) => `- ${p}`).join('\n')}

` : ''}ITEM POOL:
${restLines.map((p) => `- ${p}`).join('\n') || '- (none)'}

Respond with STRICT JSON only, no prose, no markdown fences:
{"questions":[{"id":"q1","type":"de_to_en|en_to_de|fill_blank","prompt":"...","answer":"...","item_label":"<the pool item this maps to>"}]}`;
  }

  // stage === 'grade' — lenient "possible solution" grader, shared by the
  // sentence-practice phase and the quiz. The learner's answer is assessed as a
  // candidate solution: a valid German answer that satisfies the prompt counts
  // as correct even if it differs from the expected answer. When the answer
  // differs from what was intended, the intended solution is always returned.
  return GRADER_PROMPT;
}

export const GRADER_PROMPT = `You are a fair, encouraging German tutor grading ONE answer. Treat the learner's answer as a POSSIBLE solution: if it is a valid, grammatical German answer that genuinely satisfies the prompt — even when it differs from the expected answer — mark it correct. Only mark it incorrect when it has real errors (wrong vocabulary, broken grammar, a missing or wrong umlaut, or it does not answer the prompt).

Whenever the learner's answer differs from the intended answer — whether you marked it correct or not — fill "intended" with the intended/model solution so the learner sees the originally-expected form. If the learner's answer essentially matches the intended one, leave "intended" empty.

Accept minor punctuation/casing slips. Note umlaut and spelling problems specifically in the feedback.

Respond with STRICT JSON only, no prose, no markdown fences:
{"correct":true|false,"feedback":"<one short line>","error_type":"spelling|umlaut|vocab|grammar|none","intended":"<the intended solution when it differs from the learner's, else empty>"}`;

// ---- Verb Conjugation Match exercise (js/exercises/conjugationMatch.js) ---
// This curriculum's vocab is mostly natural first-person example phrases
// ("Ich brauche — I need", "Ich hätte gern — I would like"), not bare
// dictionary infinitives — so rather than trying to regex-extract a verb
// stem and hand-conjugate it (German has enough irregularity — sein, the
// modals, stem-changing strong verbs — that a bespoke rules engine would be
// risky with no test suite to check it against), this hands the candidate
// vocab lines to the model and asks it to both identify the verb AND
// produce the full conjugation table, skipping anything that isn't
// actually built around one conjugatable verb.
export function buildConjugationPrompt(candidates, pastIssues = []) {
  const pool = candidates.map((v) => `${v.vocab_id} :: ${v.german} — ${v.english}`).join('\n');
  return `You are a German verb conjugation reference helping build a practice exercise. Each line below is a vocabulary entry the learner has already studied — some are natural first-person example phrases ("Ich brauche — I need", "Ich hätte gern — I would like"), others are infinitive phrases of varying length ("brauchen — to need", "sich duschen — to shower", "spazieren gehen — to go for a walk"). For each line that is built around ONE conjugatable verb, identify that verb's infinitive and produce its FULL conjugation for all six persons, in the SAME tense/mood as the example (e.g. "Ich möchte" and "Ich hätte" are already modal/Konjunktiv II forms — conjugate in that same mood, don't switch to a different tense).

Skip any line that isn't actually built around a single conjugatable verb (a greeting, a noun phrase, a phrase with no clear single verb, etc.) — just omit it from your output entirely, don't guess.
${pastIssuesBlock(pastIssues)}
VOCAB ENTRIES (format is "id :: German — English"):
${pool}

Rules:
- Each form is the conjugated verb ONLY — no extra words, no trailing complement (e.g. drop the "gern" from "Ich hätte gern", drop the "aus" complement from "Ich komme aus", drop the bare second infinitive from "spazieren gehen" or the noun object from "Rad fahren"/"Sport treiben" — conjugate only the finite verb). For "brauchen": ich="brauche", du="brauchst", er_sie_es="braucht", wir="brauchen", ihr="braucht", sie_Sie="brauchen".
- EXCEPTION — genuine reflexive verbs (e.g. "sich duschen", "sich freuen", "sich interessieren für"): the reflexive pronoun is NOT a droppable extra word here, because unlike "gern" or "aus" it changes with the person and is grammatically required — dropping it produces a different, often ungrammatical or wrong-meaning verb. Include the correct person-matching reflexive pronoun (mich/dich/sich/uns/euch/sich) in each form. For "sich duschen": ich="dusche mich", du="duschst dich", er_sie_es="duscht sich", wir="duschen uns", ihr="duscht euch", sie_Sie="duschen sich".
- "er_sie_es" is the single 3rd-person-singular form (shared by er/sie/es). "sie_Sie" is the 3rd-person-plural/formal-"you" form (shared by sie/Sie).
- Get irregular and stem-changing verbs right (e.g. "fahren" → du fährst, er fährt; "sein" → ich bin, du bist, er ist, wir sind, ihr seid, sie sind) — a learner is drilling on exactly this.
- "infinitive" in your output is the verb's dictionary form (e.g. "brauchen", "sein", "mögen" for möchte).
- Match each output entry back to its input id exactly.

Respond with STRICT JSON only, no prose, no markdown fences:
{"verbs":[{"id":"<the input id>","infinitive":"<dictionary form>","forms":{"ich":"...","du":"...","er_sie_es":"...","wir":"...","ihr":"...","sie_Sie":"..."}}]}`;
}
