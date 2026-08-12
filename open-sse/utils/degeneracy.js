// Catching a model that has stopped replying and started continuing.
//
// When a model loses the speaker boundary it does not answer the last turn — it
// extends it, in the user's voice, resuming the token stream mid-sentence. Two
// observed endings, both Gemini-served:
//
//   " you seems like hallucinating again"
//   ". JUST WHAT YOU HAVE DONE IN THIS CURRENT SESSION"
//
// The stray leading space and the stray leading period are the tell. Neither is
// how a reply begins; both are how a continuation resumes.
//
// The request translator is where this is prevented (see config/emptyTurn.js).
// This is the net under it, and it is deliberately a *detector*, not an editor.
// The response to a positive is to fail over to the next combo member, not to
// delete text: a retry costs one upstream call and is recoverable, whereas
// deleting content the user needed is not. That asymmetry is why the thresholds
// here can be tighter than the echo filter's.

// Judged on the opening only. A long answer that started well is never re-judged
// — the failure mode is present from the first token or not at all.
export const GATE_WINDOW_CHARS = 240;

// Enough visible text to judge an opening. Below this a verdict is guesswork.
export const GATE_MIN_JUDGEABLE_CHARS = 24;

// Upper bound on how many chunks the hold-back window will read before giving up
// and letting the stream through unjudged. Latency is a real cost; a stream that
// has produced nothing visible by here is not the failure mode this catches.
export const PREFLIGHT_MAX_READS = 24;

// Wall-clock budget for the judging window. Only spent when the stream actually
// pauses — back-to-back chunks resolve immediately — so this is the worst case
// added to time-to-first-byte, not the typical case.
export const HOLD_BACK_MS = 300;

// Pulls the model's visible text out of one already-translated SSE frame. These
// are client formats, not the 40-odd provider shapes — the gate runs after
// translation, so it only has to understand what we ourselves emit.
export function extractVisibleText(parsed) {
  if (!parsed || typeof parsed !== "object") return "";

  // OpenAI chat completions
  const openai = parsed.choices?.[0]?.delta?.content;
  if (typeof openai === "string") return openai;

  // Claude messages
  if (parsed.type === "content_block_delta" && typeof parsed.delta?.text === "string") {
    return parsed.delta.text;
  }

  // Gemini / Antigravity candidates. `thought` parts are reasoning, not the
  // reply, and reasoning legitimately opens mid-thought — judging it would be a
  // false-positive machine.
  const parts = (parsed.response || parsed).candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((p) => p?.thought !== true && typeof p?.text === "string")
      .map((p) => p.text)
      .join("");
  }

  return "";
}

// A reply never opens with sentence punctuation. A continuation does — it is
// finishing the clause it was handed.
function opensOnPunctuation(raw) {
  // An ellipsis is a stylistic opening ("...actually, let me reconsider"), not a
  // resumed clause. A continuation comes back on a single mark.
  if (/^\s*\.\.\./.test(raw)) return false;
  return /^\s*[.,;:!?]/.test(raw);
}

// Exactly one leading space before a lowercase word is a resumed token stream:
// it is the space the model emits when it believes it is continuing an
// unfinished line.
//
// One space, not "one or more". Indentation is the common legitimate case — a
// reply opening on an indented code line ("    const result = …") or a nested
// bullet is not a continuation, and treating it as one throws away a good
// answer. A tab is indentation by definition and never matches.
function resumesMidSentence(raw) {
  return /^ (?! )[a-z]/.test(raw);
}

/**
 * Returns a short reason when the opening looks like a continuation rather than
 * a reply, or null.
 *
 * Both rules are structural and judge only how the text opens. An earlier draft
 * also flagged a reply that appeared inside the user's own message, which review
 * showed fires on an ordinary opening that restates the task ("Refactor the
 * authentication…"), and a false positive here discards a combo member. Verbatim
 * regurgitation is already handled downstream by utils/userEcho.js, where the
 * cost of a mistake is bounded; neither observed incident needed the rule.
 */
export function findDegeneracy(visibleText) {
  if (typeof visibleText !== "string" || !visibleText.trim()) return null;
  const window = visibleText.slice(0, GATE_WINDOW_CHARS);

  if (opensOnPunctuation(window)) return "reply opens on sentence punctuation";
  if (resumesMidSentence(window)) return "reply resumes mid-sentence";
  return null;
}

// A request whose last message is an assistant turn is a prefill: the model is
// being handed an unfinished line and asked to continue it. Resuming
// mid-sentence is the correct behaviour there, so the gate must not run.
export function hasAssistantPrefill(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages[messages.length - 1]?.role === "assistant";
}
