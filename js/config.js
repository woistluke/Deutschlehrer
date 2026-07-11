// config.js — defaults and constants. User-editable values live in Settings
// and are stored per-browser; these are only the fallback defaults.

// App version — #.#.# (major.minor.patch), shown top-right in the topbar
// (see app.js renderShell) so Luke can confirm which build he's testing
// against before giving feedback. Convention: the 3rd number (patch) is
// bumped by whoever implements a change, every time, as part of that same
// commit — no exceptions, no batching multiple changes under one patch
// bump. The 1st/2nd numbers (major/minor) only change when Luke explicitly
// says so; never bump those on your own judgment.
export const VERSION = '1.0.0';

export const DEFAULTS = {
  // Conversation tutor (Groq). Verify the current model string at console.groq.com.
  tutorModel: 'llama-3.3-70b-versatile',
  tutorTemperature: 0.7,

  // Quiz grader — deliberately a separate, stricter configuration.
  // Can point at the same provider with a different model/temperature.
  quizModel: 'llama-3.3-70b-versatile',
  quizTemperature: 0.2,

  // OpenAI TTS + transcription (per the existing app's stack).
  ttsModel: 'gpt-4o-mini-tts',
  ttsVoice: 'nova',
  transcribeModel: 'whisper-1',

  // Endpoints
  groqBase: 'https://api.groq.com/openai/v1',
  openaiBase: 'https://api.openai.com/v1',
};

// Spaced-repetition interval ladder (days). Each correct answer advances one
// level; a miss drops two levels (min 0). next_due = last_seen + ladder[level].
export const SRS_LADDER_DAYS = [0, 1, 3, 7, 14, 30, 90];

// Fraction of a unit's vocabulary that must clear mastery before the next
// unit unlocks. Less than 1 so the last word or two doesn't gate progress —
// stragglers keep getting prioritized into later units' sessions instead
// (see getUnmasteredFromPriorUnits in store.js) and can push the unit over
// the line passively once they cross the threshold.
export const UNIT_COMPLETION_RATIO = 0.85;

// How many review items to surface per session, and how strongly to favor
// recent units. Recency weight multiplies an item's selection priority by
// 1 / (1 + units_since_completed).
export const REVIEW = {
  maxItemsPerSession: 8,
  recencyBiased: true,
};

// localStorage keys
export const LS = {
  settings: 'aufdeutsch.settings',
  activeUser: 'aufdeutsch.activeUser',
  localData: 'aufdeutsch.localdata', // fallback store when Supabase isn't configured
};
