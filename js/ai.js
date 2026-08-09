// ai.js — provider calls. Conversation + quiz go to Groq's OpenAI-compatible
// endpoint (different models/temperatures); TTS + transcription to OpenAI.

import { DEFAULTS } from './config.js';

function getSettings() {
  try { return JSON.parse(localStorage.getItem('aufdeutsch.settings')) || {}; }
  catch { return {}; }
}

// Every provider call goes through this so a hung request (bad network, a
// stalled model, etc.) can't leave the UI stuck on "Denke nach…" / "Checking…"
// forever with no way to recover short of a full reload. On timeout the
// caller sees a plain, retryable Error rather than a fetch abort exception.
const REQUEST_TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s — check your connection and try again.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function chatCompletion({ base, key, model, temperature, messages, jsonMode }) {
  if (!key) throw new Error('Missing API key. Add it in Settings.');
  const body = { model, temperature, messages };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetchWithTimeout(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Chat API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Resolves which provider generates tutor conversation replies + quiz/
// sentence questions, per the "Provider" setting in Settings (see
// config.js's textProvider default and js/pages/settings.js). Groq and
// OpenAI both expose the same OpenAI-compatible /chat/completions shape
// chatCompletion() above calls, so switching provider is nothing more than
// swapping which base/key/model triple gets passed in — no separate code
// path needed. TTS/transcription (speak/transcribe below) are unaffected --
// those always use OpenAI regardless of this setting, since Groq doesn't
// offer them.
function textProviderSettings(s) {
  const provider = s.textProvider === 'openai' ? 'openai' : 'groq';
  if (provider === 'openai') {
    return {
      provider,
      base: s.openaiBase || DEFAULTS.openaiBase,
      key: s.openaiKey,
      tutorModel: s.openaiTutorModel || DEFAULTS.openaiTutorModel,
      quizModel: s.openaiQuizModel || DEFAULTS.openaiQuizModel,
    };
  }
  return {
    provider,
    base: s.groqBase || DEFAULTS.groqBase,
    key: s.groqKey,
    tutorModel: s.tutorModel || DEFAULTS.tutorModel,
    quizModel: s.quizModel || DEFAULTS.quizModel,
  };
}

// Structured tutor turn — the tutor model returns JSON with reply, translation,
// corrections, tip and vocab (the rich conversation format ported from the
// original single-file app). Falls back to a plain reply object if the model
// doesn't produce parseable JSON.
export async function tutorStructured(systemPrompt, history) {
  const s = getSettings();
  const p = textProviderSettings(s);
  const raw = await chatCompletion({
    base: p.base,
    key: p.key,
    model: p.tutorModel,
    temperature: s.tutorTemperature ?? DEFAULTS.tutorTemperature,
    messages: [{ role: 'system', content: systemPrompt }, ...history],
    jsonMode: true,
  });
  return parseTutorJson(raw);
}

function parseTutorJson(raw) {
  let clean = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
  if (first !== -1 && last !== -1) clean = clean.slice(first, last + 1);
  try {
    const p = JSON.parse(clean);
    return {
      reply: p.reply || '',
      translation: p.translation || '',
      corrections: Array.isArray(p.corrections) ? p.corrections : [],
      tip: p.tip || '',
      vocab: Array.isArray(p.vocab) ? p.vocab : [],
    };
  } catch {
    return { reply: raw || '', translation: '', corrections: [], tip: '', vocab: [] };
  }
}

// Quiz model — separate, stricter config, JSON out.
export async function quizCall(systemPrompt, userContent) {
  const s = getSettings();
  const p = textProviderSettings(s);
  const raw = await chatCompletion({
    base: p.base,
    key: p.key,
    model: p.quizModel,
    temperature: s.quizTemperature ?? DEFAULTS.quizTemperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    jsonMode: true,
  });
  return safeJson(raw);
}

function safeJson(text) {
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('Quiz model did not return valid JSON.');
  }
}

// OpenAI text-to-speech → returns an object URL for an <audio> element.
export async function speak(germanText) {
  const s = getSettings();
  if (!s.openaiKey) throw new Error('Missing OpenAI key. Add it in Settings.');
  const res = await fetchWithTimeout(`${s.openaiBase || DEFAULTS.openaiBase}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiKey}` },
    body: JSON.stringify({
      model: s.ttsModel || DEFAULTS.ttsModel,
      voice: s.ttsVoice || DEFAULTS.ttsVoice,
      input: germanText,
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  return URL.createObjectURL(await res.blob());
}

// OpenAI Whisper transcription from a recorded audio Blob.
export async function transcribe(blob) {
  const s = getSettings();
  if (!s.openaiKey) throw new Error('Missing OpenAI key. Add it in Settings.');
  const form = new FormData();
  form.append('file', blob, 'speech.webm');
  form.append('model', s.transcribeModel || DEFAULTS.transcribeModel);
  form.append('language', 'de');
  const res = await fetchWithTimeout(`${s.openaiBase || DEFAULTS.openaiBase}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.openaiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Transcribe ${res.status}: ${await res.text()}`);
  return (await res.json()).text || '';
}
