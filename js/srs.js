// srs.js — spaced repetition scheduling and mastery scoring.
import { SRS_LADDER_DAYS } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Apply a graded answer to a progress record and return the updated fields.
// `correct` is a boolean. Returns a partial record to persist.
export function applyAnswer(record, correct, now = new Date()) {
  const timesSeen = (record.times_seen || 0) + 1;
  const timesCorrect = (record.times_correct || 0) + (correct ? 1 : 0);

  let level = record.srs_level || 0;
  if (correct) {
    level = Math.min(level + 1, SRS_LADDER_DAYS.length - 1);
  } else {
    level = Math.max(level - 2, 0);
  }

  const intervalDays = SRS_LADDER_DAYS[level];
  const nextDue = new Date(now.getTime() + intervalDays * DAY_MS);

  // Mastery blends accuracy with how far up the ladder the item has climbed,
  // so a freshly-correct item isn't treated as "mastered" after one hit.
  const accuracy = timesCorrect / timesSeen;
  const ladderProgress = level / (SRS_LADDER_DAYS.length - 1);
  const mastery = round2(0.6 * accuracy + 0.4 * ladderProgress);

  return {
    times_seen: timesSeen,
    times_correct: timesCorrect,
    srs_level: level,
    last_seen: now.toISOString(),
    next_due: nextDue.toISOString(),
    mastery_score: mastery,
  };
}

// Items whose next_due has passed (or was never set).
export function isDue(record, now = new Date()) {
  if (!record.next_due) return true;
  return new Date(record.next_due).getTime() <= now.getTime();
}

// A unit counts as complete once at least `completionRatio` of its tracked
// items meet the unit threshold — defaults to every item, but callers can
// pass a lower ratio (e.g. UNIT_COMPLETION_RATIO) so a unit doesn't stay
// gated on its last straggler word or two.
export function unitMeetsThreshold(progressRecords, threshold, completionRatio = 1) {
  if (progressRecords.length === 0) return false;
  const met = progressRecords.filter((p) => (p.mastery_score || 0) >= threshold).length;
  return met / progressRecords.length >= completionRatio;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
