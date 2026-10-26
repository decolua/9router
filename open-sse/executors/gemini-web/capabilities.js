// Request-contract guards for the Gemini Web executor.
//
// gemini-web is not an API client. It launches Playwright, types ONE flat
// prompt string into the gemini.google.com `.ql-editor` contenteditable,
// presses Enter, and captures the first `StreamGenerate` response off the page.
// There is no JSON request body on the wire, which makes two OpenAI controls
// structurally impossible to honor:
//
//   • `reasoning_effort` — no field exists to carry a thinking budget.
//   • forced `tool_choice` — the tools support gemini-web does have is the
//     prompt-emulation shim: it ASKS the model, in prose, to answer with
//     `<tool>{...}</tool>` and parses whatever comes back. That is best-effort
//     by construction. "required" / "any" / a named function is a GUARANTEE,
//     and a prompt cannot make one.
//
// Deliberately NOT rejected — these are already satisfied or already work:
//   • `reasoning_effort: "none" | "minimal"` — a non-thinking provider
//     trivially complies.
//   • `tool_choice: "auto" | "none"` and plain `tools[]` — the emulation path.

/** `error.code` on every compatibility rejection raised here. */
export const GEMINI_WEB_UNSUPPORTED_CONTROL_CODE = "unsupported_control_for_provider";

/** Effort levels a non-thinking provider already complies with. */
const SATISFIED_EFFORT_LEVELS = new Set(["none", "minimal"]);

/** `tool_choice` strings that demand a tool call rather than merely offering one. */
const FORCING_TOOL_CHOICE_STRINGS = new Set(["required", "any"]);

/** `tool_choice: { type }` values that pin the model to a specific/any tool. */
const FORCING_TOOL_CHOICE_TYPES = new Set(["function", "tool", "any"]);

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

/**
 * True when `tool_choice` demands a tool call. Covers the OpenAI strings
 * ("required"), the Anthropic-flavored ones the translators also emit ("any"),
 * and the object forms that name a function or force any tool. "auto" / "none"
 * and every unrecognized shape are treated as non-forcing — this guard only
 * blocks contracts it is certain gemini-web cannot keep.
 */
export function isForcingToolChoice(toolChoice) {
  const asString = normalizeString(toolChoice);
  if (asString) return FORCING_TOOL_CHOICE_STRINGS.has(asString);

  if (toolChoice && typeof toolChoice === "object" && !Array.isArray(toolChoice)) {
    const type = normalizeString(toolChoice.type);
    return type !== null && FORCING_TOOL_CHOICE_TYPES.has(type);
  }

  return false;
}

/** True when `reasoning_effort` asks for MORE thinking than "none at all". */
export function requestsThinkingBudget(reasoningEffort) {
  const effort = normalizeString(reasoningEffort);
  if (effort === null) return false;
  return !SATISFIED_EFFORT_LEVELS.has(effort);
}

/**
 * Inspect an OpenAI-shaped request body for controls gemini-web cannot honor.
 * Returns the first violation found, or `null` when the request is servable.
 */
export function checkGeminiWebUnsupportedControls(body) {
  if (!body || typeof body !== "object") return null;

  if (requestsThinkingBudget(body.reasoning_effort)) {
    return {
      param: "reasoning_effort",
      message:
        'Model provider "gemini-web" does not support "reasoning_effort". It drives the ' +
        "gemini.google.com web UI through a typed prompt and has no thinking-budget control " +
        'to set, so any effort above "minimal" would be silently ignored. Remove ' +
        '"reasoning_effort" (or send "none"/"minimal") or route to a reasoning-capable model.',
    };
  }

  if (isForcingToolChoice(body.tool_choice)) {
    return {
      param: "tool_choice",
      message:
        'Model provider "gemini-web" cannot guarantee a forced tool call. Its tool support is ' +
        "prompt-emulated — the model is asked to emit a tool block and may answer with prose " +
        'instead — so "tool_choice" values that require one ("required", "any", or a named ' +
        'function) cannot be honored. Use "auto" to keep best-effort tool calling, or route to ' +
        "a model with native function calling.",
    };
  }

  return null;
}
