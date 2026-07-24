-- Auf Deutsch — curriculum engine schema for Supabase (Postgres)
-- Run this in the Supabase SQL editor once, before using the app.
--
-- SECURITY NOTE: this app uses a plain-text user handle, not real auth.
-- The policies below allow the anon key to read/write all rows. That is
-- fine for a 2-person trusted test, but it is NOT secure isolation:
-- anyone with the anon key + a handle can read that handle's data.
-- To harden later, switch to Supabase Auth and replace the policies with
-- ones scoped to auth.uid(). See README "Hardening" section.

-- ---------------------------------------------------------------------------
-- users: just a handle. No password.
create table if not exists app_users (
  user_id     text primary key,                       -- e.g. "luke", "tester1"
  display_name text,
  created_at  timestamptz not null default now()
);

-- sections: freeform top-level grouping. Editable.
create table if not exists sections (
  section_id  uuid primary key default gen_random_uuid(),
  user_id     text not null references app_users(user_id) on delete cascade,
  title       text not null,
  position    int  not null default 0,                -- ordering within the course
  notes       text,
  created_at  timestamptz not null default now()
);

-- units: freeform, belong to a section. Editable.
create table if not exists units (
  unit_id      uuid primary key default gen_random_uuid(),
  user_id      text not null references app_users(user_id) on delete cascade,
  section_id   uuid not null references sections(section_id) on delete cascade,
  title        text not null,
  position     int  not null default 0,               -- ordering within the section
  source       text,                                  -- "CBG", "Duolingo", "PaulNoble", or null
  objectives   jsonb not null default '[]'::jsonb,    -- ["ask for directions", ...]
  grammar_focus jsonb not null default '[]'::jsonb,   -- ["wo vs wohin", ...]
  mastery_threshold real not null default 0.8,
  status       text not null default 'locked',        -- locked | available | in_progress | complete
  created_at   timestamptz not null default now()
);

-- vocab: belongs to a unit.
create table if not exists vocab (
  vocab_id   uuid primary key default gen_random_uuid(),
  user_id    text not null references app_users(user_id) on delete cascade,
  unit_id    uuid not null references units(unit_id) on delete cascade,
  german     text not null,
  english    text not null,
  notes      text,                                    -- trouble notes, e.g. umlaut reminder
  created_at timestamptz not null default now()
);

-- vocab.tags existed here through 2026-07-14 but had no writer beyond an
-- empty default, no reader, and no editor UI -- dropped as dead schema
-- surface (see IMPROVEMENT_LOG.md 2026-07-14 item 4). Safe/idempotent for
-- databases provisioned before this change.
alter table vocab drop column if exists tags;

-- progress: one row per trackable item (vocab item or named grammar point).
-- item_id is deliberately free text, not a FK to vocab(vocab_id) — it also
-- holds "grammar:<unit_id>:<name>" pseudo-ids that don't correspond to any
-- vocab row, so it can't be a real foreign key. That means deleting a vocab
-- row does NOT cascade here at the DB level; the app (js/store.js
-- deleteVocab/deleteUnit) cleans up matching progress rows itself instead.
-- unit_id, below, IS a real FK and does cascade on unit delete.
create table if not exists progress (
  progress_id uuid primary key default gen_random_uuid(),
  user_id     text not null references app_users(user_id) on delete cascade,
  item_id     text not null,            -- vocab_id (uuid as text) or "grammar:<unit_id>:<name>"
  item_type   text not null,            -- 'vocab' | 'grammar' | 'listening' (aggregate dictation-accuracy row, item_id 'listening:aggregate')
  unit_id     uuid references units(unit_id) on delete cascade,
  times_seen    int  not null default 0,
  times_correct int  not null default 0,
  srs_level     int  not null default 0,   -- index into the interval ladder
  last_seen     timestamptz,
  next_due      timestamptz,
  mastery_score real not null default 0,   -- 0..1
  known_errors  jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  unique (user_id, item_id)
);

-- sessions: append-only log of what happened each session.
create table if not exists sessions (
  session_id   uuid primary key default gen_random_uuid(),
  user_id      text not null references app_users(user_id) on delete cascade,
  unit_id      uuid references units(unit_id) on delete set null,
  mode         text not null default 'curriculum',  -- curriculum | review | free | conjugation_match
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  items_reviewed   jsonb not null default '[]'::jsonb,
  items_introduced jsonb not null default '[]'::jsonb,
  errors_observed  jsonb not null default '[]'::jsonb,
  outcome      text                                  -- in_progress | unit_complete | ended
);

-- content_feedback: learner-flagged issues on LLM-generated exercise/quiz
-- content ("this answer was too vague", "vocab is too advanced for this
-- lesson", etc.) — see js/feedback.js. Deliberately negative-only: there is
-- no positive/rating counterpart, this is a running list of known problems.
-- prompts.js reads recent rows back in as a "known issues to avoid" section
-- when generating new sentences/quiz items/conjugation tables, so it's the
-- app's only feedback loop for content quality. unit_id is nullable since
-- not every flaggable item is unit-scoped (e.g. Verb Conjugation Match).
create table if not exists content_feedback (
  content_feedback_id uuid primary key default gen_random_uuid(),
  user_id      text not null references app_users(user_id) on delete cascade,
  context_type text not null,                          -- sentence_drill | quiz | conjugation_match | conversation
  item_type    text,                                    -- e.g. en_to_de, fill_blank, word_order...
  unit_id      uuid references units(unit_id) on delete set null,
  unit_title   text,
  prompt_text  text,                                    -- the question/prompt shown to the learner
  answer_text  text,                                     -- the expected/intended answer, if applicable
  note         text not null,                            -- the learner's free-text description of the issue
  status       text not null default 'open',             -- open | reviewed | addressed
  created_at   timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_sections_user on sections(user_id, position);
create index if not exists idx_units_section on units(section_id, position);
create index if not exists idx_vocab_unit on vocab(unit_id);
create index if not exists idx_progress_user_due on progress(user_id, next_due);
create index if not exists idx_sessions_user on sessions(user_id, started_at desc);
create index if not exists idx_content_feedback_user on content_feedback(user_id, context_type, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security. Permissive for anon (see SECURITY NOTE above).
alter table app_users enable row level security;
alter table sections  enable row level security;
alter table units     enable row level security;
alter table vocab     enable row level security;
alter table progress  enable row level security;
alter table sessions  enable row level security;
alter table content_feedback enable row level security;

-- One permissive policy per table for the anon role. Replace with
-- auth.uid()-scoped policies when you add real authentication.
do $$
declare t text;
begin
  foreach t in array array['app_users','sections','units','vocab','progress','sessions','content_feedback']
  loop
    execute format(
      'drop policy if exists anon_all on %I; create policy anon_all on %I for all to anon using (true) with check (true);',
      t, t);
  end loop;
end $$;
