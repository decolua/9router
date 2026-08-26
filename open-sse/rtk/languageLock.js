// Pin the response language.
//
// Models in the cheaper bands — deepseek-v4-pro most of all — reason in Chinese
// and sometimes carry it into visible output. Measured across 223 transcripts
// (2026-08-09 → 08-14): 135 Han occurrences inside `thinking` blocks and one in
// a user-visible `text` block. The thinking figure is the one that matters here,
// because this operator runs the client in verbose mode and therefore READS the
// thinking — so "it leaked into the chat" is mostly reasoning shown as intended,
// in a language the operator does not read.
//
// Filtering the output was rejected. Stripping CJK from a response would corrupt
// any legitimate quotation of file content, and it treats the symptom at the last
// possible moment. An instruction reaches the model before it generates, costs
// ~25 tokens, and is the one class of directive models follow reliably.
//
// Unconditional, like disciplineNudge: this is a policy setting, not a token
// saver, so it does not consult tokenSaverEnabled. Fail-open, like every rtk hook.

import { injectSystemPrompt } from "./systemInject.js";

// Override per-deployment if this router ever serves someone who wants otherwise.
export const RESPONSE_LANGUAGE = process.env.NINER_RESPONSE_LANGUAGE || "English";

export function buildLanguageLock(language = RESPONSE_LANGUAGE) {
  return (
    `Write in ${language}. This applies to every part of the response — visible text, ` +
    `internal reasoning, commit messages and summaries alike. Do not switch language ` +
    `part-way through, and do not reason in one language and answer in another.`
  );
}

export function injectLanguageLock(finalBody, format, language = RESPONSE_LANGUAGE) {
  try {
    if (!finalBody || !language) return null;
    injectSystemPrompt(finalBody, format, buildLanguageLock(language));
    return language;
  } catch {
    return null;   // fail-open: never break a request over a nudge
  }
}
