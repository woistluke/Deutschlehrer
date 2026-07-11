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

// Remove progress rows matching arbitrary fields. On Supabase, deleting a
// unit already cascades to its progress rows via the unit_id FK, and vocab
// deletion has no FK to cascade from at all (progress.item_id is free text,
// since an item can also be a "grammar:..." pseudo-id) — and the localStorage
// fallback has no FK cascades of any kind. So every delete path below cleans
// up its own progress rows explicitly, on both backends, rather than leaving
// them to accumulate as dead data.
async function removeProgressWhere(match) {
  if (remote) {
    let q = client.from('progress').delete();
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const { error } = await q;
    if (error) throw error;
    return;
  }
  const all = localAll();
  const rows = tbl(all, 'progress');
  all.progress = rows.filter((r) => !Object.entries(match).every(([k, v]) => r[k] === v));
  localSave(all);
}

// ---- sections -------------------------------------------------------------
export const createSection = (userId, fields) =>
  insert('sections', { user_id: userId, title: fields.title, position: fields.position ?? 0, notes: fields.notes || null });
export const updateSection = (id, patch) => update('sections', 'section_id', id, patch);
export async function deleteSection(id) {
  // Cascade to every unit in the section (which itself cascades to that
  // unit's vocab + progress — see deleteUnit) so nothing is orphaned locally.
  const units = await selectWhere('units', { section_id: id });
  await remove('sections', 'section_id', id);
  await Promise.all(units.map((u) => deleteUnit(u.unit_id)));
}

// ---- units ----------------------------------------------------------------
export const createUnit = (userId, fields) =>
  insert('units', {
    user_id: userId, section_id: fields.section_id, title: fields.title,
    position: fields.position ?? 0, source: fields.source || null,
    objectives: fields.objectives || [], grammar_focus: fields.grammar_focus || [],
    mastery_threshold: fields.mastery_threshold ?? 0.8, status: fields.status || 'locked',
  });
export const updateUnit = (id, patch) => update('units', 'unit_id', id, patch);
export async function deleteUnit(id) {
  const vocabRows = await selectWhere('vocab', { unit_id: id });
  await remove('units', 'unit_id', id);
  await Promise.all(vocabRows.map((v) => remove('vocab', 'vocab_id', v.vocab_id)));
  await removeProgressWhere({ unit_id: id });
}

// ---- vocab ----------------------------------------------------------------
export const createVocab = (userId, fields) =>
  insert('vocab', {
    user_id: userId, unit_id: fields.unit_id, german: fields.german,
    english: fields.english, notes: fields.notes || null, tags: fields.tags || [],
  });
export const updateVocab = (id, patch) => update('vocab', 'vocab_id', id, patch);
export async function deleteVocab(id) {
  await remove('vocab', 'vocab_id', id);
  await removeProgressWhere({ item_id: id });
}

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

// One-time-ish data migration: a batch of seed vocab items used to combine
// multiple standalone words/forms into a single line (e.g. "eins, zwei, drei"
// or "heute / morgen / gestern") — seed.js now lists each as its own vocab
// row instead. This maps each old combined German string to the individual
// entries it should become, so existing accounts (seeded before the split)
// can be migrated in place rather than only affecting brand-new curricula.
const VOCAB_SPLITS = [
  { oldGerman: 'eins, zwei, drei', newEntries: [{ german: 'eins', english: 'one', notes: null }, { german: 'zwei', english: 'two', notes: null }, { german: 'drei', english: 'three', notes: null }] },
  { oldGerman: 'heute / morgen / gestern', newEntries: [{ german: 'heute', english: 'today', notes: null }, { german: 'morgen', english: 'tomorrow', notes: null }, { german: 'gestern', english: 'yesterday', notes: null }] },
  { oldGerman: 'mein / meine', newEntries: [{ german: 'mein', english: 'my (masc./neut.)', notes: null }, { german: 'meine', english: 'my (fem./pl.)', notes: null }] },
  { oldGerman: 'das ist mein Mann/Frau', newEntries: [{ german: 'Das ist mein Mann', english: 'that\'s my husband', notes: null }, { german: 'Das ist meine Frau', english: 'that\'s my wife', notes: null }] },
  { oldGerman: 'die Mutter / der Vater', newEntries: [{ german: 'die Mutter', english: 'mother', notes: null }, { german: 'der Vater', english: 'father', notes: null }] },
  { oldGerman: 'das Kind, die Kinder', newEntries: [{ german: 'das Kind', english: 'child', notes: null }, { german: 'die Kinder', english: 'children', notes: null }] },
  { oldGerman: 'Ich habe einen Sohn / eine Tochter', newEntries: [{ german: 'Ich habe einen Sohn', english: 'I have a son', notes: 'talking about children' }, { german: 'Ich habe eine Tochter', english: 'I have a daughter', notes: 'talking about children' }] },
  { oldGerman: 'Das ist mein Bruder / meine Schwester', newEntries: [{ german: 'Das ist mein Bruder', english: 'This is my brother', notes: 'introducing siblings' }, { german: 'Das ist meine Schwester', english: 'This is my sister', notes: 'introducing siblings' }] },
  { oldGerman: 'bar / mit Karte zahlen', newEntries: [{ german: 'bar zahlen', english: 'to pay cash', notes: null }, { german: 'mit Karte zahlen', english: 'to pay by card', notes: null }] },
  { oldGerman: 'links / rechts / geradeaus', newEntries: [{ german: 'links', english: 'left', notes: null }, { german: 'rechts', english: 'right', notes: null }, { german: 'geradeaus', english: 'straight ahead', notes: null }] },
  { oldGerman: 'es regnet / es schneit', newEntries: [{ german: 'es regnet', english: 'it\'s raining', notes: null }, { german: 'es schneit', english: 'it\'s snowing', notes: null }] },
  { oldGerman: 'der Sommer / der Winter', newEntries: [{ german: 'der Sommer', english: 'summer', notes: null }, { german: 'der Winter', english: 'winter', notes: null }] },
  { oldGerman: 'warm / kalt', newEntries: [{ german: 'warm', english: 'warm', notes: null }, { german: 'kalt', english: 'cold', notes: null }] },
  { oldGerman: 'zuerst / dann / danach', newEntries: [{ german: 'zuerst', english: 'first', notes: null }, { german: 'dann', english: 'then', notes: null }, { german: 'danach', english: 'afterward', notes: null }] },
  { oldGerman: 'langweilig / spannend', newEntries: [{ german: 'langweilig', english: 'boring', notes: null }, { german: 'spannend', english: 'exciting', notes: null }] },
  { oldGerman: 'joggen / schwimmen / wandern', newEntries: [{ german: 'joggen', english: 'to jog', notes: null }, { german: 'schwimmen', english: 'to swim', notes: null }, { german: 'wandern', english: 'to hike', notes: null }] },
  { oldGerman: 'der Kollege / die Kollegin', newEntries: [{ german: 'der Kollege', english: 'colleague (male)', notes: null }, { german: 'die Kollegin', english: 'colleague (female)', notes: null }] },
  { oldGerman: 'deshalb / deswegen', newEntries: [{ german: 'deshalb', english: 'therefore, that\'s why', notes: 'Triggers normal verb-second order, unlike weil.' }, { german: 'deswegen', english: 'therefore, that\'s why', notes: 'Triggers normal verb-second order, unlike weil.' }] },
  { oldGerman: 'ich war / ich hatte', newEntries: [{ german: 'ich war', english: 'I was', notes: null }, { german: 'ich hatte', english: 'I had', notes: null }] },
  { oldGerman: 'konnte / musste / wollte', newEntries: [{ german: 'konnte', english: 'could', notes: 'Präteritum of modal verbs.' }, { german: 'musste', english: 'had to', notes: 'Präteritum of modal verbs.' }, { german: 'wollte', english: 'wanted to', notes: 'Präteritum of modal verbs.' }] },
  { oldGerman: 'mit dem/der…', newEntries: [{ german: 'mit dem…', english: 'with whom/which (masc./neut. dative)', notes: 'Dative relative pronoun.' }, { german: 'mit der…', english: 'with whom/which (fem. dative)', notes: 'Dative relative pronoun.' }] },
  { oldGerman: 'dessen / deren', newEntries: [{ german: 'dessen', english: 'whose (masc./neut. genitive)', notes: 'Genitive relative pronoun.' }, { german: 'deren', english: 'whose (fem./pl. genitive)', notes: 'Genitive relative pronoun.' }] },
  { oldGerman: 'innerhalb / außerhalb', newEntries: [{ german: 'innerhalb', english: 'within', notes: '+ genitive' }, { german: 'außerhalb', english: 'outside', notes: '+ genitive' }] },
  { oldGerman: 'von / durch', newEntries: [{ german: 'von', english: 'by', notes: 'Marks the agent in passive constructions.' }, { german: 'durch', english: 'by', notes: 'Marks the agent in passive constructions.' }] },
];

// Split one user's matching combined-vocab rows into their individual entries,
// carrying progress forward instead of resetting it to zero. For each old row
// found (matched by trimmed/case-insensitive German text):
//   - times_seen / times_correct are divided evenly across the new rows (with
//     any remainder handed to the first ones) so the aggregate review count
//     doesn't multiply just because a word got split into pieces;
//   - srs_level / mastery_score / next_due / last_seen / known_errors are
//     copied as-is to every new row, since they describe learned-ness rather
//     than a count, and there's no way to know per-sub-word history;
//   - the old vocab row (and its now-superseded progress row) is deleted via
//     deleteVocab, which already cleans up progress on both backends.
// Safe to re-run: once a row is split, its old combined German text no longer
// exists to match against, so a second run finds nothing left to do.
export async function splitCombinedVocab(userId) {
  const sections = await getCurriculum(userId);
  const report = { rowsSplit: 0, rowsCreated: 0 };

  for (const sec of sections) {
    for (const unit of sec.units) {
      for (const v of (unit.vocab || [])) {
        const rule = VOCAB_SPLITS.find((r) => norm(r.oldGerman) === norm(v.german));
        if (!rule) continue;

        const oldProgress = await getProgress(userId, v.vocab_id);
        const n = rule.newEntries.length;

        let baseSeen = 0, accuracy = 0;
        if (oldProgress) {
          baseSeen = Math.floor((oldProgress.times_seen || 0) / n);
          accuracy = (oldProgress.times_seen || 0) > 0
            ? (oldProgress.times_correct || 0) / oldProgress.times_seen
            : 0;
        }
        const remainder = oldProgress ? (oldProgress.times_seen || 0) % n : 0;

        for (let i = 0; i < n; i++) {
          const entry = rule.newEntries[i];
          const created = await createVocab(userId, {
            unit_id: unit.unit_id, german: entry.german, english: entry.english, notes: entry.notes || null,
          });
          report.rowsCreated++;
          if (oldProgress) {
            const timesSeen = baseSeen + (i < remainder ? 1 : 0);
            const timesCorrect = Math.min(timesSeen, Math.round(timesSeen * accuracy));
            await upsertProgress(userId, created.vocab_id, {
              item_type: 'vocab', unit_id: unit.unit_id,
              times_seen: timesSeen, times_correct: timesCorrect,
              srs_level: oldProgress.srs_level || 0,
              mastery_score: oldProgress.mastery_score || 0,
              last_seen: oldProgress.last_seen || null,
              next_due: oldProgress.next_due || null,
              known_errors: oldProgress.known_errors || [],
            });
          }
        }

        await deleteVocab(v.vocab_id); // also removes the old progress row
        report.rowsSplit++;
      }
    }
  }
  return report;
}

export async function splitCombinedVocabForAllUsers() {
  const users = await listUsers();
  const results = [];
  for (const u of users) {
    const report = await splitCombinedVocab(u.user_id);
    results.push({ userId: u.user_id, ...report });
  }
  return results;
}
// Known duplicate groups from the vocab-dedup content pass (see
// IMPROVEMENT_LOG.md 2026-07-10 second pass, item 4) — maps a normalized
// German term to whichever unit's copy should survive when duplicates of it
// are found live in an account. Used only as a tiebreak hint: any duplicate
// NOT in this list (e.g. one added manually after seeding) still gets
// merged, just falling back to "keep the oldest row" instead.
const DUPLICATE_KEEP_UNIT = {
  'ich bin': 'Greetings & Introductions',
  'die familie': 'Greetings & Introductions',
  'woher kommst du?': 'Greetings & Introductions',
  'morgen': 'Numbers, Time & Days',
  'das wochenende': 'Numbers, Time & Days',
  'wie alt bist du?': 'Talking About Yourself',
  'ich möchte': 'Café & Restaurant',
  'ein ticket kaufen': 'Directions & Getting Around',
  'die fahrkarte': 'Directions & Getting Around',
  'die wohnung': 'Housing & Furniture',
  'der sommer': 'Weather & Seasons',
  'gegessen': 'Perfekt — Irregular & Sein-Verbs',
  'das ziel': 'Perfekt — Irregular & Sein-Verbs',
  'die erfahrung': 'Perfekt — Irregular & Sein-Verbs',
  'ich bin nach hause gegangen': 'Perfekt — Irregular & Sein-Verbs',
  'ich freue mich darauf': 'Future Plans',
  'die freizeit': 'Hobbies & Interests',
  'ich denke, dass': 'Expressing Opinions',
  'deshalb': 'Giving Reasons',
  'nämlich': 'Giving Reasons',
  'die meinung': 'News & Current Events',
  'die kritik': 'News & Current Events',
  'die flexibilität': 'Nominalization & Formal Writing',
  'trotzdem': 'Nominalization & Formal Writing',
  'in diesem zusammenhang': 'Literary & Academic Texts',
};

// Merge exact-duplicate vocab (same German text, case/whitespace-insensitive)
// found across different units in one account into a single surviving row,
// combining their progress instead of leaving two untracked-together rows
// for what's really one word. The reverse of splitCombinedVocab above:
//   - the survivor is whichever row's unit matches DUPLICATE_KEEP_UNIT for
//     that term, if any; otherwise the oldest row (by created_at, when
//     available) wins;
//   - times_seen / times_correct are SUMMED across the merged rows;
//   - srs_level / mastery_score take the MAX across the group, so folding a
//     weaker duplicate in never downgrades existing progress;
//   - next_due / last_seen come from whichever row had that max
//     mastery_score, as the most representative schedule;
//   - known_errors is the union of every merged row's;
//   - every non-surviving row is removed via deleteVocab (which also cleans
//     up its own progress row).
// Safe to re-run: once a group is down to one row, there's nothing left to
// find.
export async function mergeDuplicateVocab(userId) {
  const sections = await getCurriculum(userId);
  const report = { groupsMerged: 0, rowsRemoved: 0 };

  const groups = {};
  for (const sec of sections) {
    for (const unit of sec.units) {
      for (const v of (unit.vocab || [])) {
        if (!v.german) continue;
        const key = norm(v.german);
        (groups[key] ||= []).push({ v, unit });
      }
    }
  }

  for (const [key, rows] of Object.entries(groups)) {
    if (rows.length < 2) continue;

    const preferredUnit = DUPLICATE_KEEP_UNIT[key];
    let survivorIdx = preferredUnit != null
      ? rows.findIndex((r) => norm(r.unit.title) === norm(preferredUnit))
      : -1;
    if (survivorIdx === -1) {
      survivorIdx = rows.reduce((bestIdx, r, i) => {
        const a = r.v.created_at ? new Date(r.v.created_at).getTime() : Infinity;
        const b = rows[bestIdx].v.created_at ? new Date(rows[bestIdx].v.created_at).getTime() : Infinity;
        return a < b ? i : bestIdx;
      }, 0);
    }

    const survivor = rows[survivorIdx];
    const others = rows.filter((_, i) => i !== survivorIdx);

    const progressRows = await Promise.all(rows.map((r) => getProgress(userId, r.v.vocab_id)));
    const present = progressRows.filter(Boolean);

    if (present.length) {
      const timesSeen = present.reduce((n, p) => n + (p.times_seen || 0), 0);
      const timesCorrect = Math.min(timesSeen, present.reduce((n, p) => n + (p.times_correct || 0), 0));
      const best = present.reduce((a, b) => ((b.mastery_score || 0) > (a.mastery_score || 0) ? b : a));
      const knownErrors = [...new Set(present.flatMap((p) => p.known_errors || []))];
      await upsertProgress(userId, survivor.v.vocab_id, {
        item_type: 'vocab', unit_id: survivor.unit.unit_id,
        times_seen: timesSeen, times_correct: timesCorrect,
        srs_level: best.srs_level || 0,
        mastery_score: best.mastery_score || 0,
        last_seen: best.last_seen || null,
        next_due: best.next_due || null,
        known_errors: knownErrors,
      });
    }

    for (const other of others) {
      await deleteVocab(other.v.vocab_id); // also removes its progress row
      report.rowsRemoved++;
    }
    report.groupsMerged++;
  }

  return report;
}

export async function mergeDuplicateVocabForAllUsers() {
  const users = await listUsers();
  const results = [];
  for (const u of users) {
    const report = await mergeDuplicateVocab(u.user_id);
    results.push({ userId: u.user_id, ...report });
  }
  return results;
}


// The active unit = first non-complete unit in course order. A unit with no
// vocab yet (e.g. a title-only stub just added in the Curriculum editor) has
// nothing to master, so maybePromote's mastery check can never clear it —
// left alone, that would permanently softlock every unit after it, since
// this always returns the FIRST non-complete unit. Auto-complete such units
// on the way past instead of returning them as "active."
export async function getActiveUnit(userId) {
  const sections = await getCurriculum(userId);
  for (const s of sections) {
    for (const u of s.units) {
      if (u.status === 'complete') continue;
      const vocabCount = (u.vocab || []).filter((v) => v.german && v.english).length;
      if (vocabCount === 0) {
        await updateUnit(u.unit_id, { status: 'complete' });
        continue;
      }
      return { section: s, unit: u };
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

// Vocab items from already-unlocked units that come BEFORE the given unit in
// curriculum order, whose mastery hasn't cleared their own unit's threshold
// (never-introduced counts as unmastered too). Ordered oldest-unit-first, then
// weakest-mastery-first within a unit — this is the pool that lets earlier
// units keep closing the gap to complete during LATER units' regular lessons,
// instead of needing a dedicated re-run to mop up the last stragglers.
export async function getUnmasteredFromPriorUnits(userId, activeUnitId, limit = 8) {
  const [progress, sections] = await Promise.all([allProgress(userId), getCurriculum(userId)]);
  const progByItem = {};
  progress.forEach((p) => { progByItem[p.item_id] = p; });

  const flat = sections.flatMap((s) => s.units);
  const activeIdx = flat.findIndex((u) => u.unit_id === activeUnitId);
  const priorUnits = (activeIdx === -1 ? flat : flat.slice(0, activeIdx)).filter((u) => u.status !== 'locked');

  const weak = [];
  priorUnits.forEach((u, unitPos) => {
    const threshold = u.mastery_threshold ?? 0.8;
    (u.vocab || []).forEach((v) => {
      if (!v.german || !v.english) return;
      const mastery = progByItem[v.vocab_id]?.mastery_score || 0;
      if (mastery < threshold) weak.push({ v, unitPos, mastery });
    });
  });
  weak.sort((a, b) => a.unitPos - b.unitPos || a.mastery - b.mastery);
  return weak.slice(0, limit).map((w) => w.v);
}

// ---- content feedback (flag-an-issue on generated exercises/quiz items) --
// Learner-flagged problems with LLM-generated content — see js/feedback.js
// for the UI and prompts.js for how these get read back into generation.
// Deliberately negative-only (per Luke: there's no "this question was
// great" signal to collect, only "this was wrong/too advanced/vague"), so
// treat this as a running list of known pitfalls to avoid repeating, not a
// rating system.
export const createContentFeedback = (userId, fields) =>
  insert('content_feedback', {
    user_id: userId,
    context_type: fields.contextType,
    item_type: fields.itemType || null,
    unit_id: fields.unitId || null,
    unit_title: fields.unitTitle || null,
    prompt_text: fields.prompt || null,
    answer_text: fields.answer || null,
    note: fields.note,
    status: 'open',
    created_at: new Date().toISOString(),
  });

export const allContentFeedback = (userId) => selectWhere('content_feedback', { user_id: userId });

// Most recent N feedback notes for a given context (sentence_drill | quiz |
// conjugation_match), formatted as short strings ready to drop into a
// prompt. Takes the already-fetched full list rather than querying itself,
// so callers that need multiple context types (e.g. runner.js wanting both
// sentence_drill and quiz) only fetch once.
export function recentFeedbackNotes(all, contextType, limit = 6) {
  return (all || [])
    .filter((f) => f.context_type === contextType && f.note)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit)
    .map((f) => (f.prompt_text ? `"${f.prompt_text}" — ${f.note}` : f.note));
}
