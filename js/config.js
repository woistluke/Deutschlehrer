// config.js — defaults and constants. User-editable values live in Settings
// and are stored per-browser; these are only the fallback defaults.

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
