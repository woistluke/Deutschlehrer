// cefr.js — a rough CEFR estimate from in-app activity. This is a heuristic,
// not a placement test: it reads vocabulary mastered, course progress, and
// quiz accuracy, and weights the three skills differently (reading leans on
// recognition, speaking on production). Treat it as a motivating gauge.
//
// What "100%" means here (see IMPROVEMENT_LOG.md 2026-07-15, item 1):
// vocabComponent/courseComponent are scaled against THIS APP'S OWN current
// curriculum size (vocabTotal, unitsTotal below) — a relative "how much of
// what Auf Deutsch teaches have you mastered" gauge, mapped onto CEFR-shaped
// bands. It is deliberately NOT rescaled to externally-published CEFR
// vocabulary-size benchmarks (rough published estimates: A1≈750, A2≈1250,
// B1≈2750, B2≈4500, C1≈9000 cumulative words) — Auf Deutsch's curriculum
// (645 words / 40 units as of writing) is well short of those, especially
// at the B2/C1 end, so "100% of the curriculum" reading as "C1" on this
// gauge is a claim about finishing this app's content, not an external,
// exam-calibrated placement. Luke chose this relative framing over
// recalibrating to the external benchmarks (which would show a lower,
// more conservative number today, likely capping around A2) — see the
// log entry for the tradeoff. Previously this used fixed absolute anchors
// (1500 words, 120 units) sized for a much bigger hypothetical course than
// the one that actually exists, which meant 100% completion of the REAL
// curriculum could never clear band B1 no matter how much was mastered —
// an internal inconsistency, independent of which external framing is
// preferred, that this rescaling fixes.

const BANDS = ['A1', 'A2', 'B1', 'B2', 'C1'];

// Map a 0..100 ability score to a band + position within that band.
function toBand(score) {
  const s = clamp(score, 0, 100);
  const idx = Math.min(BANDS.length - 1, Math.floor(s / 20));
  const within = (s - idx * 20) / 20; // 0..1 within the band
  return { band: BANDS[idx], within: round2(within), score: round2(s) };
}

// Minimum listening-dictation reps before its accuracy is trusted as a
// signal — below this, a lucky/unlucky streak of 1-2 items would swing the
// score too hard, so listening falls back to the same blended shape reading
// uses until there's enough of a sample.
const MIN_LISTENING_REPS = 3;

// metrics: { masteredVocab, vocabTotal, unitsComplete, unitsTotal, accuracy(0..1),
//            conversationSessions, listeningAccuracy(0..1|null), listeningReps }
// conversationSessions is curriculum-lesson sessions + Free Conversation
// sessions combined (see pages/stats.js's speakingPracticeSessions) —
// deliberately not free-conversation-only, since a curriculum lesson's own
// conversation phase (phase 3) is real spoken production too.
export function estimateLevels(m) {
  // Scaled against the curriculum's OWN current size, not a fixed absolute —
  // see the file header for what that does and doesn't mean. Falls back to
  // a denominator of 1 (not 0) so an empty/unseeded curriculum can't divide
  // by zero; masteredVocab/unitsComplete would be 0 in that case anyway.
  const vocabComponent = clamp((m.masteredVocab || 0) / Math.max(1, m.vocabTotal || 0), 0, 1);
  const courseComponent = clamp((m.unitsComplete || 0) / Math.max(1, m.unitsTotal || 0), 0, 1);
  const accuracyComponent = clamp(m.accuracy || 0, 0, 1);

  const base = 100 * (0.55 * vocabComponent + 0.35 * courseComponent + 0.10 * accuracyComponent);

  // Skill tilts: recognition is reached earlier than production.
  const reading = base * 1.05;
  // Listening used to just be a blended-accuracy copy of reading (base *
  // 0.95) with no signal of its own. Once there's a real sample of
  // listening-dictation reps, swap the generic accuracy term for the
  // listening-specific one so this skill actually reflects hearing German,
  // not overall quiz performance.
  const hasListeningSignal = m.listeningAccuracy != null && (m.listeningReps || 0) >= MIN_LISTENING_REPS;
  const listeningAccuracyComponent = hasListeningSignal ? clamp(m.listeningAccuracy, 0, 1) : accuracyComponent;
  const listeningBase = 100 * (0.55 * vocabComponent + 0.35 * courseComponent + 0.10 * listeningAccuracyComponent);
  const listening = listeningBase * 0.95;
  const speaking = base * 0.88 + Math.min(8, (m.conversationSessions || 0) * 0.5);

  const overall = (reading + listening + speaking) / 3;
  return {
    reading: toBand(reading),
    listening: toBand(listening),
    speaking: toBand(speaking),
    overall: toBand(overall),
  };
}

// Reading readiness toward a target band (default B1) — a fun, goal-anchored gauge.
export function readinessToward(overallScore, targetBand = 'B1') {
  const target = (BANDS.indexOf(targetBand)) * 20; // B1 -> 40
  return clamp((overallScore / Math.max(1, target)) * 100, 0, 100);
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round2(n) { return Math.round(n * 100) / 100; }
