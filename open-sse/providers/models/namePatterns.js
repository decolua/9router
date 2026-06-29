// Derive a display name from a model id when the entry omits `name` (mirrors PATTERN_PRICING).
// Provider entries that ship their own `name` always win; this is only a fallback for terse entries.

// Capitalize a hyphen/space separated token group: "coder-plus" → "Coder Plus".
function titleCase(s) {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// Ordered: first match wins. Keep specific patterns above generic ones.
export const NAME_PATTERNS = [
  [/^kimi-k(\d+(?:\.\d+)?)(-thinking)?$/i, (m) => `Kimi K${m[1]}${m[2] ? " Thinking" : ""}`],
  [/^glm-(\d+(?:\.\d+)?)(v)?$/i, (m) => `GLM ${m[1]}${m[2] ? "V (Vision)" : ""}`],
  [/^minimax-m(\d+(?:\.\d+)?)$/i, (m) => `MiniMax M${m[1]}`],
  [/^gpt-(.+)$/i, (m) => `GPT ${titleCase(m[1])}`],
  [/^gemini-(.+)$/i, (m) => `Gemini ${titleCase(m[1])}`],
  [/^grok-(.+)$/i, (m) => `Grok ${titleCase(m[1])}`],
  [/^deepseek-(.+)$/i, (m) => `DeepSeek ${titleCase(m[1])}`],
  [/^qwen([\d.]+.*)$/i, (m) => `Qwen ${titleCase(m[1])}`],
];

// id → display name (regex fallback → id verbatim)
export function deriveModelName(id) {
  if (typeof id !== "string") return id;
  for (const [re, fn] of NAME_PATTERNS) {
    const m = id.match(re);
    if (m) return fn(m);
  }
  return id;
}
