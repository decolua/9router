// Maps a request user-agent to the client app shown on the Spend page.
export function clientOf(ua = "") {
  const u = ua.toLowerCase();
  if (u.startsWith("claude-cli") || u.includes("claude-code")) return "Claude Code";
  if (u.includes("codex")) return "Codex";
  if (u.startsWith("open-code-review")) return "OpenCode Review";
  if (u.includes("opencode")) return "OpenCode";
  if (u.startsWith("t3")) return "T3 Code";
  if (!u) return "Unknown";
  return "Other";
}
