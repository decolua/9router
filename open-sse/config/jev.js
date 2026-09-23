// Jev / System One smart-routing config — constants only.
// Per open-sse/AGENTS.md: ALL config lives here, nothing is hardcoded elsewhere.
//
// Jev is NOT a chat model or combo member. It is a System One decision model:
// unstructured state in, typed probabilities out. Smart routing evaluates the
// current ask through any configured 9router System One provider, then changes
// which combo model is tried first. The availability/quota ladder stays intact.

// Works without credentials because OpenCode exposes this System One model on
// its no-auth lane. Users can instead choose an OpenRouter/Vercel/future model.
export const JEV_DEFAULT_CLASSIFIER_MODEL = "oc/jev-1.13-free";

// Complexity tiers, cheapest → most capable. Mirrors LiteLLM's complexity router.
export const JEV_TIERS = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"];

// Default criteria for the single `choice` question. Overridable per combo via
// comboStrategies[name].smartCriteria.
export const JEV_DEFAULT_CRITERIA = {
  SIMPLE: "Direct lookups, greetings, single-file extraction, trivial edits, formatting.",
  MEDIUM: "Localized bug fixes, writing a function, small refactors within one file/module.",
  COMPLEX: "Multi-file changes, architecture, integration/design decisions, debugging across a system.",
  REASONING: "Hard algorithmic/mathematical reasoning, subtle concurrency/correctness proofs, deep analysis.",
};
export const JEV_DEFAULT_INSTRUCTIONS =
  "Classify the coding task by the least-capable model tier that can complete it well.";

// Never send the whole transcript / tool-result blobs to the classifier.
export const JEV_STATE_CHAR_BUDGET = 4000;

// Fail-open deadline + process-local breaker. The in-process System One request
// may finish after our deadline because its upstream fetch owns cancellation;
// the chat request does not wait for it and the normal combo order is used.
export const JEV_TIMEOUT_MS = 3000;
export const JEV_BREAKER_COOLDOWN_MS = 30000;

// Below this confidence, preserve the combo's existing order.
export const JEV_MIN_CONFIDENCE = 0.5;
