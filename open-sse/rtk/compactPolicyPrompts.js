// Compact Response Policies: per-policy concise-reply snippets.
// Independent from Caveman (style compression). These target specific
// behaviors and can be composed in any combination.

export const COMPACT_POLICY_KEYS = {
  NO_PREAMBLE: "noPreamble",
  NO_TOOL_NARRATION: "noToolNarration",
  FORMAT_ENFORCEMENT: "formatEnforcement",
};

export const COMPACT_POLICY_PROMPTS = {
  [COMPACT_POLICY_KEYS.NO_PREAMBLE]: [
    "Skip preambles and sign-offs.",
    "Do not open with acknowledgements (\"Sure!\", \"Of course\", \"Great question\", \"I'd be happy to\", \"Here is what I'll do\").",
    "Do not close with summaries of what you just did, offers of further help, or follow-up questions when the user did not ask for them.",
    "Start with the answer. End when the answer ends.",
  ].join(" "),

  [COMPACT_POLICY_KEYS.NO_TOOL_NARRATION]: [
    "In tool-using / agentic loops, do not narrate tool calls.",
    "Do not say \"Let me read the file\", \"I'll search for\", \"Now I'll run\", or otherwise announce a tool call before making it.",
    "Do not restate tool results back to the user in prose when the tool output is already visible. Only speak when you have a conclusion, a decision, or a question that requires user input.",
    "Between tool calls, output nothing unless a status change is meaningful to the user.",
  ].join(" "),

  [COMPACT_POLICY_KEYS.FORMAT_ENFORCEMENT]: [
    "Prefer structured formats over prose for technical content.",
    "Code, configs, commands, file paths, error messages: always in code blocks, never paraphrased into sentences.",
    "Lists of items, steps, options, or comparisons: use bullets or a table, not a paragraph.",
    "Reserve prose for explanation that genuinely needs sentence flow (reasoning, tradeoffs, why). One paragraph max per explanation block.",
  ].join(" "),
};

// Stable order so concatenated output is deterministic across runs (helps with prefix caching).
export const COMPACT_POLICY_ORDER = [
  COMPACT_POLICY_KEYS.NO_PREAMBLE,
  COMPACT_POLICY_KEYS.NO_TOOL_NARRATION,
  COMPACT_POLICY_KEYS.FORMAT_ENFORCEMENT,
];

// Build a single combined prompt from a policies-state object like { noPreamble: true, ... }.
// Returns null if no policies are active.
export function buildCompactPolicyPrompt(policies) {
  if (!policies || typeof policies !== "object") return null;
  const active = COMPACT_POLICY_ORDER.filter((k) => policies[k] === true);
  if (active.length === 0) return null;

  const lines = active.map((k) => COMPACT_POLICY_PROMPTS[k]).filter(Boolean);
  if (lines.length === 0) return null;

  return ["Response policies (apply to every reply):", ...lines].join("\n\n");
}
