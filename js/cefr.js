// cefr.js — a rough CEFR estimate from in-app activity. This is a heuristic,
// not a placement test: it reads vocabulary mastered, course progress, and
// quiz accuracy, and weights the three skills differently (reading leans on
// recognition, speaking on production). Treat it as a motivating gauge.

const BANDS = ['A1', 'A2', 'B1', 'B2', 'C1'];

// Map a 0..100 ability score to a band + position within that band.
function toBand(score) {
  const s = clamp(score, 0, 100);
  const idx = Math.min(BANDS.length - 1, Math.floor(s / 20));
  const within = (s - idx * 20) / 20; // 0..1 within the band
  return { band: BANDS[idx], within: round2(within), score: round2(s) };
}

// metrics: { masteredVocab, unitsComplete, unitsTotal, accuracy(0..1), conversationSessions }
export function estimateLevels(m) {
  const vocabComponent = clamp((m.masteredVocab || 0) / 1500, 0, 1);     // ~1500 mastered ≈ B1-ish recognition
  // Anchor to an absolute course size (~120 units ≈ a full A1–B1 path) so a
  // tiny finished curriculum can't, on its own, imply a high level.
  const courseComponent = clamp((m.unitsComplete || 0) / 120, 0, 1);
  const accuracyComponent = clamp(m.accuracy || 0, 0, 1);

  const base = 100 * (0.55 * vocabComponent + 0.35 * courseComponent + 0.10 * accuracyComponent);

  // Skill tilts: recognition is reached earlier than production.
  const reading = base * 1.05;
  const listening = base * 0.95;
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
