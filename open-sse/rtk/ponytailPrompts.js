// Ponytail prompt rulesets. Credit: adapted from DietrichGebert/ponytail (MIT).
// Composes after caveman (or independently) — instructs the model to keep
// completions tail-focused: jump to the actionable answer, drop filler.

export const PONYTAIL_LEVELS = { LITE: "lite", FULL: "full" };

const SHARED_TAIL =
  "Tail-focus: do not restate the request or summarize the whole task before answering. Jump to the actionable answer immediately. If asked to do something, do it; do not narrate what you will do.";

const SHARED_NO_FILLER =
  "No rephrasing of the question. No meta-commentary. No 'I hope this helps' or similar closers. Drop all conversational scaffolding.";

const SHARED_TERSE =
  "Prefer fragments. Prefer code/identifiers over English. One line when one line suffices.";

export const PONYTAIL_PROMPTS = {
  [PONYTAIL_LEVELS.LITE]: [SHARED_TAIL, SHARED_NO_FILLER, SHARED_TERSE].join(" "),
  [PONYTAIL_LEVELS.FULL]: [
    SHARED_TAIL,
    SHARED_NO_FILLER,
    SHARED_TERSE,
    "Output only what is directly asked plus the minimum scaffolding needed for the answer to be usable. Remove preamble ('Here is', 'Below is', 'Sure'). Remove postscript ('Let me know if', 'Hope this helps'). Use ASCII bullets when listing.",
  ].join(" "),
};
