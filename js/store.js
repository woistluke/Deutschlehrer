// store.js — data access layer. Uses Supabase when configured, otherwise a
// localStorage fallback so the app is testable before you paste your keys.
// Both backends expose the same method surface.

import { LS, REVIEW } from './config.js';
import { SEED_CURRICULUM } from './seed.js';

let client = null;       // supabase client when remote
let remote = false;

export function initStore(settings) {
  remote = false;
  client = null;
  if (settings?.supabaseUrl && settings?.supabaseAnonKey && window.supabase) {
    try {
      client = window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey);
      remote = true;
    } catch (e) {
      console.error('Supabase init failed, using local fallback:', e);
    }
  }
  return remote;
}

export function isRemote() { return remote; }

// ---- localStorage backend -------------------------------------------------
function localAll() {
  try { return JSON.parse(localStorage.getItem(LS.localData)) || {}; }
  catch { return {}; }
}
function localSave(all) { localStorage.setItem(LS.localData, JSON.stringify(all)); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2)); }

function tbl(all, name) { all[name] = all[name] || []; return all[name]; }

// ---- generic helpers ------------------------------------------------------
async function insert(table, row) {
  if (remote) {
    const { data, error } = await client.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  }
  const all = localAll();
  const idField = `${table.replace(/s$/, '')}_id`;
  const rec = { ...row };
  if (!rec[idField] && table !== 'app_users') rec[idField] = uid();
  tbl(all, table).push(rec);
  localSave(all);
  return rec;
}

async function update(table, idField, idValue, patch) {
  if (remote) {
    const { data, error } = await client.from(table).update(patch).eq(idField, idValue).select().single();
    if (error) throw error;
    return data;
  }
  const all = localAll();
  const rows = tbl(all, table);
  const i = rows.findIndex((r) => r[idField] === idValue);
  if (i >= 0) { rows[i] = { ...rows[i], ...patch }; localSave(all); return rows[i]; }
  return null;
}

async function remove(table, idField, idValue) {
  if (remote) {
    const { error } = await client.from(table).delete().eq(idField, idValue);
    if (error) throw error;
    return;
  }
  const all = localAll();
  all[table] = tbl(all, table).filter((r) => r[idField] !== idValue);
  localSave(all);
}

async function selectWhere(table, match) {
  if (remote) {
    let q = client.from(table).select('*');
    for (const [k, v] of Object.entries(match || {})) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const all = localAll();
  return tbl(all, table).filter((r) =>
    Object.entries(match || {}).every(([k, v]) => r[k] === v));
}

// ---- users ----------------------------------------------------------------
export async function ensureUser(userId, displayName) {
  const existing = await selectWhere('app_users', { user_id: userId });
  if (existing.length) return existing[0];
  return insert('app_users', { user_id: userId, display_name: displayName || userId });
}

export async function listUsers() { return selectWhere('app_users', {}); }

// ---- sections -------------------------------------------------------------
export const createSection = (userId, fields) =>
  insert('sections', { user_id: userId, title: fields.title, position: fields.position ?? 0, notes: fields.notes || null });
export const updateSection = (id, patch) => update('sections', 'section_id', id, patch);
export const deleteSection = (id) => remove('sections', 'section_id', id);

// ---- units ----------------------------------------------------------------
export const createUnit = (userId, fields) =>
  insert('units', {
    user_id: userId, section_id: fields.section_id, title: fields.title,
    position: fields.position ?? 0, source: fields.source || null,
    objectives: fields.objectives || [], grammar_focus: fields.grammar_focus || [],
    mastery_threshold: fields.mastery_threshold ?? 0.8, status: fields.status || 'locked',
  });
export const updateUnit = (id, patch) => update('units', 'unit_id', id, patch);
export const deleteUnit = (id) => remove('units', 'unit_id', id);

// ---- vocab ----------------------------------------------------------------
export const createVocab = (userId, fields) =>
  insert('vocab', {
    user_id: userId, unit_id: fields.unit_id, german: fields.german,
    english: fields.english, notes: fields.notes || null, tags: fields.tags || [],
  });
export const updateVocab = (id, patch) => update('vocab', 'vocab_id', id, patch);
export const deleteVocab = (id) => remove('vocab', 'vocab_id', id);

// ---- progress -------------------------------------------------------------
export async function getProgress(userId, itemId) {
  const rows = await selectWhere('progress', { user_id: userId, item_id: itemId });
  return rows[0] || null;
}
export async function upsertProgress(userId, itemId, fields) {
  const existing = await getProgress(userId, itemId);
  const base = { user_id: userId, item_id: itemId, updated_at: new Date().toISOString(), ...fields };
  if (existing) return update('progress', 'progress_id', existing.progress_id, base);
  return insert('progress', { item_type: fields.item_type || 'vocab', ...base });
}
export const allProgress = (userId) => selectWhere('progress', { user_id: userId });

// ---- sessions -------------------------------------------------------------
export const createSession = (userId, fields) =>
  insert('sessions', { user_id: userId, mode: fields.mode || 'curriculum', unit_id: fields.unit_id || null, outcome: 'in_progress', started_at: new Date().toISOString() });
export const updateSession = (id, patch) => update('sessions', 'session_id', id, patch);
export const recentSessions = async (userId, n = 10) => {
  const rows = await selectWhere('sessions', { user_id: userId });
  return rows.sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, n);
};
export const allSessions = (userId) => selectWhere('sessions', { user_id: userId });

// ---- composite reads ------------------------------------------------------
// Full nested curriculum: [{...section, units:[{...unit, vocab:[...]}]}]
export async function getCurriculum(userId) {
  const [sections, units, vocab] = await Promise.all([
    selectWhere('sections', { user_id: userId }),
    selectWhere('units', { user_id: userId }),
    selectWhere('vocab', { user_id: userId }),
  ]);
  sections.sort((a, b) => a.position - b.position);
  const byUnit = {};
  for (const v of vocab) (byUnit[v.unit_id] = byUnit[v.unit_id] || []).push(v);
  const bySection = {};
  for (const u of units) {
    u.vocab = byUnit[u.unit_id] || [];
    (bySection[u.section_id] = bySection[u.section_id] || []).push(u);
  }
  for (const s of sections) {
    s.units = (bySection[s.section_id] || []).sort((a, b) => a.position - b.position);
  }
  return sections;
}

// Has this user been seeded yet?
export async function isSeeded(userId) {
  const s = await selectWhere('sections', { user_id: userId });
  return s.length > 0;
}

// Populate a fresh user from the proposed seed curriculum.
export async function seedCurriculum(userId) {
  for (const sec of SEED_CURRICULUM.sections) {
    const section = await createSection(userId, { title: sec.title, position: sec.position, notes: sec.notes });
    let up = 0;
    for (const u of sec.units) {
      const unit = await createUnit(userId, {
        section_id: section.section_id, title: u.title, position: up++, source: u.source,
        objectives: u.objectives, grammar_focus: u.grammar_focus,
        status: (sec.position === 0 && up === 1) ? 'available' : 'locked',
      });
      for (const v of u.vocab) {
        await createVocab(userId, { unit_id: unit.unit_id, german: v.german, english: v.english, notes: v.notes });
      }
    }
  }
}

// ---- admin: curriculum sync ------------------------------------------
// Pushes whatever is in seed.js into an EXISTING user's curriculum without
// touching their progress. Matches sections/units by title (trim + case-
// insensitive) — this app's curriculum is freeform, so title is the only
// stable handle across the seed and the DB. Two modes:
//   - default: additive only. Missing sections/units/vocab are created;
//     anything that already exists (including its status, mastery
//     threshold, and position) is left exactly alone.
//   - { refreshMetadata: true }: also overwrites objectives/grammar_focus/
//     source on matched units and notes on matched sections with the
//     seed's current text. Still never touches status/mastery/position,
//     and never deletes anything a user added that isn't in the seed.
// Run this again any time seed.js changes — re-running is always safe.
const norm = (s) => (s || '').trim().toLowerCase();

export async function syncCurriculumToSeed(userId, opts = {}) {
  const refresh = !!opts.refreshMetadata;
  const existing = await getCurriculum(userId);
  const report = { sectionsAdded: 0, unitsAdded: 0, vocabAdded: 0, sectionsUpdated: 0, unitsUpdated: 0 };

  let sectionPos = existing.length;
  for (const sec of SEED_CURRICULUM.sections) {
    let dbSection = existing.find((s) => norm(s.title) === norm(sec.title));
    if (!dbSection) {
      dbSection = await createSection(userId, { title: sec.title, position: sectionPos++, notes: sec.notes });
      dbSection.units = [];
      existing.push(dbSection);
      report.sectionsAdded++;
    } else if (refresh && (dbSection.notes || null) !== (sec.notes || null)) {
      await updateSection(dbSection.section_id, { notes: sec.notes });
      report.sectionsUpdated++;
    }

    let unitPos = dbSection.units.length;
    for (const u of sec.units) {
      let dbUnit = dbSection.units.find((x) => norm(x.title) === norm(u.title));
      if (!dbUnit) {
        dbUnit = await createUnit(userId, {
          section_id: dbSection.section_id, title: u.title, position: unitPos++, source: u.source,
          objectives: u.objectives, grammar_focus: u.grammar_focus, status: 'locked',
        });
        dbUnit.vocab = [];
        dbSection.units.push(dbUnit);
        report.unitsAdded++;
      } else if (refresh) {
        const next = { source: u.source || null, objectives: u.objectives || [], grammar_focus: u.grammar_focus || [] };
        const changed = (dbUnit.source || null) !== next.source
          || JSON.stringify(dbUnit.objectives || []) !== JSON.stringify(next.objectives)
          || JSON.stringify(dbUnit.grammar_focus || []) !== JSON.stringify(next.grammar_focus);
        if (changed) {
          await updateUnit(dbUnit.unit_id, next);
          report.unitsUpdated++;
        }
      }

      for (const v of u.vocab) {
        const has = (dbUnit.vocab || []).some((x) => norm(x.german) === norm(v.german));
        if (!has) {
          await createVocab(userId, { unit_id: dbUnit.unit_id, german: v.german, english: v.english, notes: v.notes });
          report.vocabAdded++;
        }
      }
    }
  }

  // Fresh curriculum with nothing unlocked yet (e.g. a user created outside
  // the normal first-run flow): unlock the very first unit so it's playable.
  const anyActive = existing.some((s) => s.units.some((u) => u.status !== 'locked'));
  if (!anyActive && existing.length && existing[0].units.length) {
    const first = existing[0].units[0];
    await updateUnit(first.unit_id, { status: 'available' });
  }

  return report;
}

// Run the sync across every known user — the bulk "apply globally" path.
export async function syncCurriculumToSeedForAllUsers(opts = {}) {
  const users = await listUsers();
  const results = [];
  for (const u of users) {
    const report = await syncCurriculumToSeed(u.user_id, opts);
    results.push({ userId: u.user_id, ...report });
  }
  return results;
}

// The active unit = first non-complete unit in course order.
export async function getActiveUnit(userId) {
  const sections = await getCurriculum(userId);
  for (const s of sections) {
    for (const u of s.units) {
      if (u.status !== 'complete') return { section: s, unit: u };
    }
  }
  return null;
}

// Review items due now, recency-biased toward recently completed units.
export async function getDueReviewItems(userId, limit = REVIEW.maxItemsPerSession) {
  const [prog, sections] = await Promise.all([allProgress(userId), getCurriculum(userId)]);
  // Build a unit-order index so we can weight by recency.
  const order = [];
  sections.forEach((s) => s.units.forEach((u) => order.push(u.unit_id)));
  const orderIndex = Object.fromEntries(order.map((id, i) => [id, i]));
  const lastIndex = order.length - 1;

  const now = Date.now();
  const due = prog.filter((p) => !p.next_due || new Date(p.next_due).getTime() <= now);
  due.forEach((p) => {
    const pos = orderIndex[p.unit_id] ?? 0;
    const recency = REVIEW.recencyBiased ? 1 / (1 + (lastIndex - pos)) : 1;
    p._priority = recency * (1.2 - (p.mastery_score || 0)); // weaker items rank higher too
  });
  due.sort((a, b) => b._priority - a._priority);
  return due.slice(0, limit);
}

// Weak points: low mastery regardless of due date, plus flagged errors.
export async function getWeakPoints(userId, limit = 5) {
  const prog = await allProgress(userId);
  return prog
    .filter((p) => (p.mastery_score || 0) < 0.5 || (p.known_errors || []).length)
    .sort((a, b) => (a.mastery_score || 0) - (b.mastery_score || 0))
    .slice(0, limit);
}
