/**
 * Detect CLI tool identity from request headers/body.
 * Used to determine if a request can be passed through losslessly.
 */

// Map of CLI tool identifiers to provider IDs they are "native" to
const NATIVE_PAIRS = {
  "claude": ["claude", "anthropic"],
  "gemini-cli": ["gemini-cli"],
  "antigravity": ["antigravity"],
  "codex": ["codex"],
};

/**
 * Detect which CLI tool is making the request.
 * Returns one of: "claude" | "gemini-cli" | "antigravity" | "codex" | null
 * @param {object} headers - Lowercase header key/value object
 * @param {object} body    - Parsed request body
 */
export function detectClientTool(headers = {}, body = {}) {
  const ua = (headers["user-agent"] || "").toLowerCase();
  const xApp = (headers["x-app"] || "").toLowerCase();
  const openaiIntent = (headers["openai-intent"] || "").toLowerCase();
  const initiator = (headers["x-initiator"] || headers["X-Initiator"] || "").toLowerCase();
  const originator = (headers["originator"] || "").toLowerCase();

  // Antigravity: detected via body field (not header)
  if (body.userAgent === "antigravity") return "antigravity";

  // GitHub Copilot / OAI compatible extension using Copilot chat headers
  if (ua.includes("githubcopilotchat") || openaiIntent === "conversation-panel" || initiator === "user") {
    return "github-copilot";
  }

  // Claude Code / Claude CLI
  if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") return "claude";

  // Gemini CLI
  if (ua.includes("gemini-cli")) return "gemini-cli";

  // Codex CLI/Desktop — codex-tui is the current Rust CLI, codex-cli/codex_cli_rs legacy;
  // Codex Desktop identifies via UA "Codex Desktop" or originator "codex_work_desktop"
  if (ua.includes("codex-tui") || ua.includes("codex-cli") || ua.includes("codex_cli_rs") ||
      ua.includes("codex desktop") || originator.startsWith("codex_")) return "codex";

  // DeepSeek TUI
  if (ua.includes("deepseek-tui")) return "deepseek-tui";

  return null;
}

function versionFrom(ua, patterns) {
  for (const pattern of patterns) {
    const match = ua.match(pattern);
    if (match) return match[1] || null;
  }
  return null;
}

// Human-readable client identity for observability. Keep this independent from
// passthrough detection: unknown clients still get a useful label.
export function detectClientDetails(headers = {}, body = {}) {
  const ua = String(headers["user-agent"] || headers["User-Agent"] || "").trim();
  const lower = ua.toLowerCase();
  if (lower.includes("claude-code") || lower.includes("claude-cli") || lower.includes("claude code")) {
    return { name: "Claude Code", version: versionFrom(ua, [/claude(?:[- ]code|[- ]cli)[/ ]v?([\d.]+)/i]) };
  }
  if (lower.includes("codex")) {
    // codex_cli_rs/0.169.0, codex-tui/0.1, Codex Desktop/1.2
    return { name: "Codex", version: versionFrom(ua, [/codex[\w-]*(?: desktop)?[/ ]v?(\d[\d.]*)/i]) };
  }
  if (lower.startsWith("curl/")) return { name: "curl", version: versionFrom(ua, [/curl\/([\d.]+)/i]) };
  if (lower.includes("python-requests")) return { name: "python-requests", version: versionFrom(ua, [/python-requests\/([\d.]+)/i]) };
  // openai-python/1.x, openai-node/4.x and the SDKs' "OpenAI/Python 1.99.0" form
  if (/openai[-/ ](?:python|node|js)/i.test(ua)) {
    return { name: "OpenAI SDK", version: versionFrom(ua, [/openai[-/ ](?:python|node|js)[/ ]v?(\d[\d.]*)/i]) };
  }
  if (body?.userAgent === "antigravity") return { name: "Antigravity", version: null };
  if (ua) {
    const token = ua.split(/[\s/]/)[0];
    return { name: token.slice(0, 48), version: null };
  }
  return { name: "Unknown client", version: null };
}

/**
 * Check if this CLI tool + provider pair should be passed through losslessly.
 * @param {string|null} clientTool - Result of detectClientTool()
 * @param {string} provider        - Provider ID (e.g. "claude", "gemini-cli")
 */
export function isNativePassthrough(clientTool, provider) {
  if (!clientTool) return false;
  const nativeProviders = NATIVE_PAIRS[clientTool];
  if (!nativeProviders) return false;
  // Support anthropic-compatible-* variants
  const normalizedProvider = provider.startsWith("anthropic-compatible")
    ? "anthropic"
    : provider;
  return nativeProviders.includes(normalizedProvider);
}
