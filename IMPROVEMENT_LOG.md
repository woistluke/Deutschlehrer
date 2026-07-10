# Improvement Log

Append-only log of daily review proposals for the Auf Deutsch app and their outcomes. Each entry is date-stamped. Status values: proposed, approved, implemented, rejected, deferred.

---

## 2026-07-10 — implemented (all 6 approved same-day, commit 3d2e4a7)

1. **Fix: Conversation tab loses chat history on "Back to chat."** In `js/pages/conversation.js`, `renderChat()` unconditionally creates a brand-new `createRichChat()` instance (and re-sends an opening greeting) every time the chat screen re-mounts — including when returning from flashcards or the session-review screen. Checking your vocab flashcards mid-conversation currently wipes the whole conversation instead of resuming it. Only the "change topic" path should reset; the flashcards round-trip should preserve the existing chat instance/history. Effort: small-medium. Files: `js/pages/conversation.js`.

2. **Reliability: no timeout on AI calls.** `js/ai.js`'s `chatCompletion`/`speak`/`transcribe` have no request timeout, so a hung Groq/OpenAI request leaves the UI stuck on "Denke nach…" / "Checking…" / "Grading…" indefinitely with no recovery besides a full reload. Add an `AbortController`-based timeout (~20-30s) with a clear, retryable error. Effort: small-medium. Files: `js/ai.js`.

3. **Consistency: sentence-drill phase skips forward on failure instead of offering retry.** In `js/pages/runner.js`, `mountSentencePhase()`'s catch block only offers "Skip to conversation," silently dropping the whole sentence-practice phase on a transient network error — whereas the quiz phase (`mountQuizPhase`) offers a proper "Try again" retry for the same class of failure. Mirror the quiz phase's retry pattern here. Effort: small. Files: `js/pages/runner.js`.

4. **Cleanup: stray backup file committed to the repo.** `js/seed.js.bak` is a leftover, superseded backup of `js/seed.js` (confirmed via diff — older/incomplete vocab) sitting in version control with no functional purpose. Remove it. Effort: trivial. Files: `js/seed.js.bak` (delete).

5. **Docs: README's "Integrating with your existing repo" section is stale.** It describes migrating from an original single-file app (legacy `localStorage` keys like `groq_key`/`openai_key`, a "v1.2 folder" not yet promoted to repo root) that no longer exists in this repo — there's no legacy file left to migrate from, and the modular app already *is* the repo root. Either remove this section or mark it as historical/completed so it doesn't send future-you looking for a migration that already happened. Effort: trivial. Files: `README.md`.

6. **Data hygiene: deleting vocab/units leaves orphaned progress rows.** Neither `store.js`'s `deleteVocab`/`deleteUnit` nor the schema clean up matching `progress` rows (progress references `item_id` as free text, not a FK to `vocab_id`, so there's no cascade). Harmless today but accumulates dead rows over time as the curriculum gets edited. Low priority — worth a small cleanup pass either in `deleteVocab`/`deleteUnit` (app-side) or as a periodic Supabase cleanup query. Effort: small. Files: `js/store.js`, `schema.sql`.

