# Auf Deutsch — curriculum edition (v1.2)

A curriculum engine layered onto the conversational German tutor. Five pages: **Today** (runner), **Curriculum** (editor), **Conversation** (free practice), **Stats**, **Settings**. Static, no build step — drops onto GitHub Pages as-is. Uses Supabase for cross-device storage, with a local-storage fallback so it runs before you add keys.

**New in v1.2 (Path A):** the rich conversation features from the original single-file app are now ported into the modular Conversation tab, and each lesson runs as a guided four-phase flow.

- **Conversation tab** — level (A1–C1) + topic setup, then structured replies: German text with a *show translation* toggle, inline corrections (`wrong → right` + a one-line why), culture/grammar tips, vocab chips, per-line text-to-speech, and mic transcription. Words the tutor uses are collected into **flashcards**, with **missed-card** tracking (persisted) and a session **review** screen.
- **Four-phase lessons** — every unit moves through: **1) Vocabulary** (match this lesson's German ↔ English) → **2) Sentences** (single-sentence drills: English→German, German→English, or answer a question in German) → **3) Conversation** (rich tutor chat weaving in this lesson's words plus concepts from earlier lessons) → **4) Quiz**. The quiz/sentence grader is *lenient*: it assesses your answer as a possible solution and marks it correct when it's a valid German answer even if it differs from what was expected — and always shows the intended solution when yours differs.

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
3. **Groq API key** — powers both the conversation tutor and the quiz grader.
4. **OpenAI API key** — powers text-to-speech (nova / gpt-4o-mini-tts) and Whisper transcription.
5. **Models** — tutor and quiz are configured separately, on purpose: the quiz runs at a lower temperature so grading isn't softened by the chat's encouraging tone. Verify current Groq model strings at console.groq.com.

Keys live in this browser's localStorage only. They're sent directly to Groq/OpenAI from the client, never to any server of ours.

## Supabase setup

1. Create a project at supabase.com.
2. Open the SQL editor, paste `schema.sql`, run it once. This creates `app_users`, `sections`, `units`, `vocab`, `progress`, `sessions`, with indexes and (permissive) row-level security.
3. Copy the project URL and anon key into Settings.

The first time a handle loads against an empty database, the app seeds the proposed curriculum automatically.

## How it works

- **store.js** — one data layer over two backends (Supabase primary, localStorage fallback). Same method surface either way, so the rest of the app doesn't care which is active.
- **seed.js** — the proposed starting curriculum, mapped from CBG / Duolingo / Paul Noble into the freeform sections→units→vocab shape. Only initial rows; everything is editable afterward.
- **srs.js** — spaced repetition. Correct answers climb an interval ladder (0/1/3/7/14/30/90 days); a miss drops two levels. Mastery blends accuracy with ladder position so one lucky hit doesn't count as mastered.
- **cefr.js** — the rough CEFR estimate. Reads vocabulary mastered, units completed, and quiz accuracy; tilts the three skills (reading leans on recognition, speaking on production). A motivating gauge, not a placement test.
- **prompts.js** — assembles prompts at runtime: a structured free-conversation prompt (level/topic), a structured unit-conversation prompt (active unit + due review + weak points), a single-sentence drill generator, and the quiz generator + lenient "possible solution" grader. The conversation prompts return the rich JSON (reply/translation/corrections/tip/vocab); the grader returns strict JSON.
- **ai.js** — Groq chat completions: `tutorReply` (plain text), `tutorStructured` (rich JSON conversation), and `quizCall` (strict JSON). Plus OpenAI speech/transcription.
- **chatui.js** — the shared rich structured chat component (bubbles + translation toggle + corrections + tips + vocab chips + TTS + mic). Used by both the Conversation tab and the lesson conversation phase.
- **pages/** — runner (four-phase lesson flow), editor (freeform CRUD + reorder), conversation (free chat + flashcards/review), stats (metrics + CEFR estimate), settings.
- **app.js** — shell, nav, user resolution, first-run seeding.

### Lesson flow (runner)
Start a unit → **① Vocabulary**: match the lesson's German ↔ English pairs → **② Sentences**: a handful of single-sentence drills, each graded leniently with the intended answer shown → **③ Conversation**: the tutor opens in German, weaving the just-drilled vocab together with due-review items and weak points → **④ Quiz**: the grader scores each answer and updates that item's SRS record. When every item in a unit clears its mastery threshold, the unit is marked complete and the next one unlocks. Review mode runs any unit (or everything currently due) through the same four phases, regardless of schedule.

## Integrating with your existing repo

**This `v1.2` folder is the Path A result** — the modular app is now the home, with the original single-file app's conversation richness (structured corrections/translation/tips/vocab chips, flashcards, missed-card review, TTS, mic) ported into `pages/conversation.js` + the shared `chatui.js`. The standalone `index.html` at the repo root is preserved as-is.

To make it your new home: commit the whole `v1.2` folder (not just `index.html`) — it's multi-file, so the page would 404 on `js/` and `css/` and render blank if you copied that one file alone.

Still worth doing when you pick this up:

- **Reconcile key storage.** This app reads settings from `localStorage['aufdeutsch.settings']`; your original single file uses individual keys like `groq_key` / `openai_key` / `groq_model` / `transcribe_model`. Add a one-time migration in `app.js`/`config.js` that reads those legacy keys when the new settings object is empty, so you don't have to re-enter anything.
- **Voice options.** The original had a browser-voice picker + rate + auto-speak. v1.2 uses OpenAI TTS (`ttsVoice`/`ttsModel` in Settings) and auto-speaks tutor replies; if you want the Web Speech voice picker back, add it to `chatui.js`/Settings.

## Security (read before adding a second tester)

The handle is a plain text field, not authentication. The Supabase policies in `schema.sql` let the anon key read/write all rows. That's fine for you plus one trusted tester, but anyone with the anon key and a handle could reach that handle's data. **To harden:** enable Supabase Auth, then replace the `anon_all` policies with policies scoped to `auth.uid()`, and add the user's auth id to each table. The data model already isolates by `user_id`, so this is a policy change, not a schema rewrite.

## Notes

- Provider model names drift — if a call 404s on the model, update the string in Settings.
- iOS Safari blocks enhanced system voices from web apps, which is why speech goes through OpenAI TTS rather than the Web Speech API.
- Supabase free-tier projects pause after a week of inactivity; the first request after that takes an extra second or two to wake.
