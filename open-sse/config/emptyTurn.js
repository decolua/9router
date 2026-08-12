// A turn that produced no content still happened, and it has to stay in the
// history. Drop it and the turns on either side become adjacent; the merge that
// follows fuses them, and a speaker disappears from the transcript. Do that
// enough times in a long agentic session — where every tool result arrives as a
// `user` turn — and the model is handed a conversation in which it has never
// spoken. What comes back then is not an answer but a continuation of the user's
// own sentence, in the user's voice.
//
// The placeholder must be non-whitespace. `hasValidContent` in
// translator/formats/claude.js requires `block.text?.trim()`, so a blank or
// space-only block is filtered straight back out and the merge happens anyway —
// the fix would look present and do nothing.
export const EMPTY_TURN_TEXT = "(no output)";

// True when `content` is a turn carrying nothing but the placeholder. Used to
// strip a trailing one: the last turn has no neighbours to keep apart, and an
// assistant turn in final position is a prefill the model continues from.
export function isEmptyTurnContent(content) {
  if (!Array.isArray(content) || content.length !== 1) return false;
  return content[0]?.text === EMPTY_TURN_TEXT;
}

// The Gemini shape of the same placeholder: parts rather than content blocks.
export const emptyTurnParts = () => [{ text: EMPTY_TURN_TEXT }];

export function isEmptyTurnParts(parts) {
  if (!Array.isArray(parts) || parts.length !== 1) return false;
  return parts[0]?.text === EMPTY_TURN_TEXT;
}
