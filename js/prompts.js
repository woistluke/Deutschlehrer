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

// Free-practice conversation (the Conversation tab). Level + topic chosen by
// the learner; not tied to the curriculum.
export function buildFreeConvoPrompt({ level = 'A2', topic = 'Free Conversation' } = {}) {
  return `You are an immersive German conversation partner for a ${level}-level learner. Topic: "${topic}".
Keep your German natural for ${level}: at A1/A2 use simple words and short sentences; at B2/C1 complex grammar and idioms are welcome.
Gently correct the learner's real mistakes. Pay attention to umlaut spelling (e.g. möchte vs mochte) and the wo/woher/wohin distinction.

${STRUCTURED_FORMAT}`;
}

// Curriculum conversation phase — structured, like the free tab but grounded in
// the active unit, plus review items from previous lessons and known weak points.
// ctx = { unit, sectionTitle, reviewItems, weakPoints, vocabById, mode }
export function buildUnitConvoPrompt(ctx) {
  const { unit, sectionTitle, reviewItems = [], weakPoints = [], vocabById = {}, mode = 'curriculum' } = ctx;
  const objectives = (unit?.objectives || []).join('; ');
  const grammar = (unit?.grammar_focus || []).join('; ');

  return `You are a warm, encouraging German conversation tutor for an adult learner (Luke) at roughly A1–A2 level. You speak mostly in simple German, dropping into English only inside the "translation"/"tip" fields. Keep your German at or just slightly above the learner's level.

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

HOW TO TEACH:
- Hold a real back-and-forth conversation on the unit's topic. Ask questions; wait for answers.
- Combine this lesson's new vocabulary with concepts from earlier lessons (the review items above).
- Correct real errors inline via the "corrections" field; keep "reply" flowing.
- Pay special attention to umlaut spelling (möchte vs mochte) and the wo/woher/wohin distinction — persistent issues.
- Keep turns short.

${STRUCTURED_FORMAT}

Begin now with a natural greeting in German appropriate to the unit.`;
}

// Backwards-compatible plain-text tutor prompt (kept for any non-structured caller).
export function buildTutorPrompt(ctx) {
  const { unit, sectionTitle, reviewItems = [], weakPoints = [], vocabById = {}, mode = 'curriculum' } = ctx;
  const objectives = (unit?.objectives || []).join('; ');
  const grammar = (unit?.grammar_focus || []).join('; ');
  return `You are a warm, encouraging German conversation tutor for an adult learner (Luke) at roughly A1–A2 level. You speak mostly in simple German, dropping into English only to explain or reassure.

SESSION MODE: ${mode}
CURRENT SECTION: ${sectionTitle || '—'}
CURRENT UNIT: ${unit?.title || '—'}
OBJECTIVES: ${objectives || '—'}
GRAMMAR FOCUS: ${grammar || '—'}

NEW VOCABULARY:
${vocabLines(unit?.vocab || []) || '- (none)'}
REVIEW ITEMS DUE:
${reviewLines(reviewItems, vocabById) || '- (none)'}
KNOWN WEAK POINTS:
${weakLines(weakPoints, vocabById) || '- (none)'}

Hold a real conversation, correct errors kindly inline, keep turns short, and begin now with a natural German greeting.`;
}

// Single-sentence practice generator (lesson phase 2). Produces ONE-sentence
// drills mixing English→German, German→English, and respond-in-German.
export function buildSentencePrompt(ctx) {
  const { unit, priorWeak = [] } = ctx;
  const pool = (unit?.vocab || []).map((v) => `${v.german} — ${v.english}${v.notes ? `  (note: ${v.notes})` : ''}`);
  const priorPool = priorWeak.map((v) => `${v.german} — ${v.english}${v.notes ? `  (note: ${v.notes})` : ''}`);
  return `You are a German single-sentence drill generator for an A1–A2 learner. Using the vocabulary below, create exactly 5 SINGLE-SENTENCE practice items. Each item is ONE sentence only — never a multi-turn conversation.

Mix these three types roughly evenly:
- "en_to_de": give a short English sentence; the learner translates it into German.
- "de_to_en": give a short German sentence; the learner translates it into English.
- "respond_de": ask one simple question in German; the learner answers in a single German sentence.

Use the lesson vocabulary wherever it fits. Keep everything at A1–A2.
${priorPool.length ? `
PRIORITY REVIEW — words from EARLIER units the learner hasn't mastered yet. Spend at least ${Math.min(2, priorPool.length)} of the 5 items on these before drawing more from this lesson's vocabulary:
${priorPool.map((p) => `- ${p}`).join('\n')}
` : ''}
Each of the 5 items is fully independent: its "answer" must be the direct, faithful
solution to that SAME item's "prompt" only — never borrow wording, vocabulary, or
sentence fragments from a different item in this batch. Each "prompt" and each
"answer" is exactly one complete sentence (for respond_de, one natural reply) — do
not merge two sentences together into one field. Never produce a "fill_blank" item
in this phase — only en_to_de, de_to_en, or respond_de.

THIS LESSON'S VOCABULARY:
${pool.map((p) => `- ${p}`).join('\n') || '- (none)'}

Respond with STRICT JSON only, no prose, no markdown fences:
{"items":[{"id":"s1","type":"en_to_de|de_to_en|respond_de","prompt":"<what the learner sees>","answer":"<the intended/model answer>","item_label":"<the vocab item this maps to, or empty>"}]}`;
}

// Quiz/grader prompt. stage 'generate' produces questions; stage 'grade'
// evaluates an answer leniently — see below.
export function buildQuizPrompt(ctx, stage) {
  const { unit, reviewItems = [], weakPoints = [], priorWeak = [], vocabById = {} } = ctx;
  const priorLines = priorWeak.map((v) => `${v.german} — ${v.english}`);
  const restLines = [
    ...(unit?.vocab || []).map((v) => `${v.german} — ${v.english}`),
    ...reviewItems.map((p) => { const v = vocabById[p.item_id]; return v ? `${v.german} — ${v.english}` : null; }).filter(Boolean),
    ...weakPoints.map((p) => { const v = vocabById[p.item_id]; return v ? `${v.german} — ${v.english}` : null; }).filter(Boolean),
  ].filter((line, i, arr) => arr.indexOf(line) === i && !priorLines.includes(line)); // de-dupe, and keep out of "rest" whatever's already in priority

  if (stage === 'generate') {
    return `You are a German quiz generator. Build a short mixed quiz (5–7 items) from the item pool below. Mix directions: some German→English, some English→German, at least one fill-in-the-blank sentence, and at least one that targets a known weak point.
${priorLines.length ? `
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
