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
  tags       jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- progress: one row per trackable item (vocab item or named grammar point).
create table if not exists progress (
  progress_id uuid primary key default gen_random_uuid(),
  user_id     text not null references app_users(user_id) on delete cascade,
  item_id     text not null,            -- vocab_id (uuid as text) or "grammar:<unit_id>:<name>"
  item_type   text not null,            -- 'vocab' | 'grammar'
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
  mode         text not null default 'curriculum',  -- curriculum | review | free
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  items_reviewed   jsonb not null default '[]'::jsonb,
  items_introduced jsonb not null default '[]'::jsonb,
  errors_observed  jsonb not null default '[]'::jsonb,
  outcome      text                                  -- in_progress | unit_complete
);

-- Helpful indexes
create index if not exists idx_sections_user on sections(user_id, position);
create index if not exists idx_units_section on units(section_id, position);
create index if not exists idx_vocab_unit on vocab(unit_id);
create index if not exists idx_progress_user_due on progress(user_id, next_due);
create index if not exists idx_sessions_user on sessions(user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security. Permissive for anon (see SECURITY NOTE above).
alter table app_users enable row level security;
alter table sections  enable row level security;
alter table units     enable row level security;
alter table vocab     enable row level security;
alter table progress  enable row level security;
alter table sessions  enable row level security;

-- One permissive policy per table for the anon role. Replace with
-- auth.uid()-scoped policies when you add real authentication.
do $$
declare t text;
begin
  foreach t in array array['app_users','sections','units','vocab','progress','sessions']
  loop
    execute format(
      'drop policy if exists anon_all on %I; create policy anon_all on %I for all to anon using (true) with check (true);',
      t, t);
  end loop;
end $$;
