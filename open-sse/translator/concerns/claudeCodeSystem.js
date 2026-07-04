const CLAUDE_CODE_SYSTEM_RE = /^\s*You are Claude Code\b[\s\S]{0,400}?official CLI for Claude\./i;

export function isClaudeCodeSystemText(text) {
  return typeof text === "string" && CLAUDE_CODE_SYSTEM_RE.test(text);
}

export function extractForwardableSystemText(system) {
  if (typeof system === "string") {
    return isClaudeCodeSystemText(system) ? "" : system;
  }
  if (!Array.isArray(system)) return "";
  // Claude Code delivers its system prompt as an array whose FIRST block carries
  // the identity marker and later blocks carry the rest of the harness. Detecting
  // the marker on the first non-empty block drops the whole harness, not just the
  // marker block — otherwise the trailing harness text would still leak to Kiro.
  const firstText = system.map((b) => b?.text || "").find((t) => t);
  if (isClaudeCodeSystemText(firstText)) return "";
  return system
    .map((block) => block?.text || "")
    .filter((text) => text && !isClaudeCodeSystemText(text))
    .join("\n");
}

export function extractForwardableSystemContent(content) {
  return extractForwardableSystemText(content);
}
