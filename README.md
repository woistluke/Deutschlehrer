# Auf Deutsch — curriculum edition

A curriculum engine layered onto the conversational German tutor. Five pages: **Today** (runner), **Exercises** (a catalog of standalone practice games), **Curriculum** (editor), **Stats**, **Settings**. Static, no build step — drops onto GitHub Pages as-is. Uses Supabase for cross-device storage, with a local-storage fallback so it runs before you add keys.

**Version:** shown top-right in the app itself (source of truth is `VERSION` in `js/config.js`, not this doc, so it can't go stale). `#.#.#` — the patch number bumps with every implemented change; major/minor only change on Luke's explicit say-so.

**New in v1.2 (Path A):** the rich conversation features from the original single-file app are now ported into the modular app as the Free Conversation exercise, and each lesson runs as a guided four-phase flow.

- **Exercises tab** — a growing catalog of standalone practice games, separate from the paced curriculum lessons. Currently two:
  - **Free Conversation** — level (A1–C1) + topic setup, then structured replies: German text with a *show translation* toggle, inline corrections (`wrong → right` + a one-line why), culture/grammar tips, vocab chips, per-line text-to-speech, and mic transcription. Words the tutor uses are collected into **flashcards**, with **missed-card** tracking (persisted) and a session **review** screen. (This was its own top-level tab through v1.2; it moved into Exercises once that catalog existed, since it's the same kind of standalone practice activity as everything else there.)
  - **Verb Conjugation Match** — a matching grid pairing ich/du/er.../wir/ihr/sie with the correct conjugated form, one verb per round, scoped to verbs you've already been introduced to. Conjugations are generated per session by the quiz model rather than a hand-built table.
- **Four-phase lessons** — every unit moves through: **1) Vocabulary** (match this lesson's German ↔ English, plus a quick no-API multiple-choice recognition round for any brand-new words) → **2) Sentences** (single-sentence drills mixing English→German, German→English, answer-in-German, a word-order scramble, and a listening-dictation item) → **3) Conversation** (rich tutor chat weaving in this lesson's words plus concepts from earlier lessons) → **4) Quiz**. The quiz/sentence grader is *lenient*: it assesses your answer as a possible solution and marks it correct when it's a valid German answer even if it differs from what was expected — and always shows the intended solution when yours differs (the word-order and listening items are graded more strictly, since they're testing order/hearing accuracy specifically, not general correctness).
- **Flagging bad questions (and bad tutor replies)** — every sentence drill, quiz question, conjugation-match round, and tutor chat reply (curriculum conversation phase and Free Conversation alike) has a small "⚑ Something wrong with this?" link at the bottom of its card/bubble. Flagging opens a short note field; the note is logged (`content_feedback` table) along with the question/answer (or prior message/reply, for a chat bubble) it was attached to. This is a negative-only feedback loop — there's no "this was good" counterpart — and recent notes get read back into the next round of generation as a "known issues to avoid" list (see `pastIssuesBlock` in `prompts.js`), so a pattern of complaints (too advanced, vague grading, wrong forms, a bad inline correction) should actually steer future generation away from repeating it.

## Run it locally

It's plain ES modules, so it needs to be *served* (not opened as a file://). Any static server works:

```bash
cd german-tutor-curriculum
python3 -m http.server 8099
# open http://localhost:8099
```

On first load it seeds a proposed curriculum for the handle `luke` and runs in **local mode** (data in your browser only). Add keys in Settings to go live.

## Settings to fill in

1. **Handle** — `luke`, `tester1`, etc. Switching the handle switches whose curriculum and progress you see. No password (see Security below).
2. **Supabase URL + anon key** — from your Supabase project's API settings. Until these are set, the app uses local storage.
3. **Groq API key** — powers the conversation tutor and quiz grader when Groq is the selected provider (the default — see #5).
4. **OpenAI API key** — always powers text-to-speech (nova / gpt-4o-mini-tts) and Whisper transcription; also powers the conversation tutor and quiz grader when OpenAI is the selected provider.
5. **Provider** — pick Groq (free) or OpenAI (noticeably better quality, per testing) to generate conversation replies and sentence/quiz questions. Switchable any time in Settings; each provider keeps its own model settings, so flipping back and forth doesn't lose either configuration.
6. **Models** — tutor and quiz are configured separately, on purpose: the quiz runs at a lower temperature so grading isn't softened by the chat's encouraging tone. Verify current model strings at console.groq.com (Groq) and platform.openai.com (OpenAI).

Keys live in this browser's localStorage only. They're sent directly to Groq/OpenAI from the client, never to any server of ours.

## Supabase setup

1. Create a project at supabase.com.
2. Open the SQL editor, paste `schema.sql`, run it. This creates `app_users`, `sections`, `units`, `vocab`, `progress`, `sessions`, `content_feedback`, with indexes and (permissive) row-level security. Every statement is `if not exists` / idempotent, so it's always safe to paste the current `schema.sql` in and re-run it — including after pulling an update that adds a new table (like `content_feedback` did).
3. Copy the project URL and anon key into Settings.

The first time a handle loads against an empty database, the app seeds the proposed curriculum automatically.

## How it works

- **store.js** — one data layer over two backends (Supabase primary, localStorage fallback). Same method surface either way, so the rest of the app doesn't care which is active.
- **seed.js** — the proposed starting curriculum, mapped from CBG / Duolingo / Paul Noble into the freeform sections→units→vocab shape. Only initial rows; everything is editable afterward.
- **srs.js** — spaced repetition. Correct answers climb an interval ladder (0/1/3/7/14/30/90 days); a miss drops two levels. Mastery blends accuracy with ladder position so one lucky hit doesn't count as mastered.
- **cefr.js** — the rough CEFR estimate. Reads vocabulary mastered, units completed, and quiz accuracy, scaled against the curriculum's *own current size* (not an external word-count-per-level benchmark — see the file's header comment); tilts the three skills (reading leans on recognition, speaking on production, listening on dictation accuracy once there are a few reps to trust — falls back to blended accuracy before then). A motivating gauge of curriculum progress mapped onto CEFR-shaped bands, not an externally validated placement test.
- **prompts.js** — assembles prompts at runtime: a structured free-conversation prompt (level/topic), a structured unit-conversation prompt (active unit + due review + weak points), a single-sentence drill generator, and the quiz generator + lenient "possible solution" grader. The conversation prompts return the rich JSON (reply/translation/corrections/tip/vocab); the grader returns strict JSON.
- **ai.js** — chat completions for `tutorStructured` (rich JSON conversation) and `quizCall` (strict JSON), routed to either Groq or OpenAI per the Settings "Provider" toggle (both speak the same OpenAI-compatible API, so it's just a different base/key/model). Plus OpenAI speech/transcription, always.
- **chatui.js** — the shared rich structured chat component (bubbles + translation toggle + corrections + tips + vocab chips + TTS + mic). Used by both the Free Conversation exercise and the lesson conversation phase.
- **feedback.js** — the "flag an issue" widget dropped onto sentence/quiz/conjugation-match cards and (via `chatui.js`'s `flagCtx`) tutor chat bubbles; logs to `content_feedback` via store.js. See the "Flagging bad questions" bullet above.
- **pages/** — runner (four-phase lesson flow), exercises (catalog of standalone practice games), editor (freeform CRUD + reorder), stats (metrics + CEFR estimate), settings.
- **exercises/** — one module per standalone game, each exporting `{ meta: {id, title, blurb}, mount(el, ctx) }`; `pages/exercises.js` lists them from a small catalog array. Currently `freeConversation.js` (free chat + flashcards/review — the original Conversation tab) and `conjugationMatch.js`. Adding a new game later is a new module here plus one line in that catalog.
- **app.js** — shell, nav, user resolution, first-run seeding.

### Lesson flow (runner)
Start a unit → **① Vocabulary**: match the lesson's German ↔ English pairs, then a quick multiple-choice recognition round for anything brand-new → **② Sentences**: a handful of single-sentence drills (translation both directions, answer-in-German, word-order scramble, listening dictation), each graded with the intended answer shown → **③ Conversation**: the tutor opens in German, weaving the just-drilled vocab together with due-review items and weak points → **④ Quiz**: the grader scores each answer and updates that item's SRS record. When every item in a unit clears its mastery threshold, the unit is marked complete and the next one unlocks. Review mode runs any unit (or everything currently due) through the same four phases, regardless of schedule.

### Exercises tab
Separate from the paced curriculum lessons — a catalog of standalone practice games you pick from directly, for drilling one specific skill outside the unit-by-unit flow. Each game is its own module under `exercises/`, listed by `pages/exercises.js` from a small catalog array; the intent is for this to keep growing as a series.

- **Free Conversation** — open-ended chat practice, no scoring; see the description above. The original standalone Conversation tab, moved here once this catalog existed.
- **Verb Conjugation Match** — pick a verb, tap ich/du/er.../wir/ihr/sie to their correct conjugated forms in a matching grid, one verb per round. Only draws from verbs whose vocab entry you've already been introduced to (has a progress row); a future pass may extend this ahead of your current unit. Since this curriculum's vocab is mostly natural example phrases ("Ich brauche...") rather than bare infinitives, conjugations are generated by the quiz model per session rather than a hand-built conjugation table — more reliable given German's irregular verbs (sein, the modals, stem-changing strong verbs) than a bespoke rules engine with no test suite behind it.

## History

This app began as a single-file prototype, then was rebuilt into the modular, multi-page app described above (the "Path A" rework: the curriculum engine, plus the original conversation richness — structured corrections/translation/tips/vocab chips, flashcards, missed-card review, TTS, mic — ported into `pages/conversation.js` + `chatui.js`, later moved into `exercises/freeConversation.js` once the Exercises catalog existed). That rework is complete: this repo's root already **is** the app, and there is no separate legacy file or folder left to merge in.

One idea from the original single-file app that didn't carry over: a browser-voice picker + rate control (v1.2 uses OpenAI TTS exclusively — `ttsVoice`/`ttsModel` in Settings — and auto-speaks tutor replies). Worth adding back to `chatui.js`/Settings if the Web Speech API voice picker is ever wanted alongside OpenAI TTS.

## Security (read before adding a second tester)

The handle is a plain text field, not authentication. The Supabase policies in `schema.sql` let the anon key read/write all rows. That's fine for you plus one trusted tester, but anyone with the anon key and a handle could reach that handle's data. **To harden:** enable Supabase Auth, then replace the `anon_all` policies with policies scoped to `auth.uid()`, and add the user's auth id to each table. The data model already isolates by `user_id`, so this is a policy change, not a schema rewrite.

## Notes

- Provider model names drift — if a call 404s on the model, update the string in Settings.
- iOS Safari blocks enhanced system voices from web apps, which is why speech goes through OpenAI TTS rather than the Web Speech API.
- Supabase free-tier projects pause after a week of inactivity; the first request after that takes an extra second or two to wake.
