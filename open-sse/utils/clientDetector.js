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
 * Normalize headers to a lowercase-key object.
 * @param {Headers|object|null|undefined} headers
 * @returns {Record<string, string>}
 */
export function normalizeHeaders(headers = {}) {
  if (!headers) return {};
  if (typeof headers.entries === "function") {
    const out = {};
    for (const [k, v] of headers.entries()) {
      out[String(k).toLowerCase()] = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
    }
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  }
  return out;
}

/**
 * True when the request is from Codex CLI / Desktop / VS Code extension.
 * Fail-closed: unknown clients return false.
 *
 * Signals (any one is enough):
 * - User-Agent contains codex markers (codex-cli, codex_cli_rs, codex-tui, codex_vscode, …)
 * - originator header mentions Codex
 * - x-openai-product-sku / product headers mention codex
 *
 * @param {Headers|object|null|undefined} headers
 * @param {object} [body]
 * @returns {boolean}
 */
export function isCodexClient(headers = {}, body = {}) {
  return detectClientTool(headers, body) === "codex";
}

/**
 * Detect which CLI tool is making the request.
 * Returns one of: "claude" | "gemini-cli" | "antigravity" | "codex" | "github-copilot" | "deepseek-tui" | null
 * @param {Headers|object} headers - Header map (any casing) or Fetch Headers
 * @param {object} body    - Parsed request body
 */
export function detectClientTool(headers = {}, body = {}) {
  const h = normalizeHeaders(headers);
  const ua = (h["user-agent"] || "").toLowerCase();
  const xApp = (h["x-app"] || "").toLowerCase();
  const openaiIntent = (h["openai-intent"] || "").toLowerCase();
  const initiator = (h["x-initiator"] || "").toLowerCase();
  const originator = (h["originator"] || "").toLowerCase();
  const productSku = (h["x-openai-product-sku"] || "").toLowerCase();
  const openAiClient = (h["x-openai-client"] || h["openai-client"] || "").toLowerCase();

  // Antigravity: detected via body field (not header)
  if (body?.userAgent === "antigravity") return "antigravity";

  // GitHub Copilot / OAI compatible extension using Copilot chat headers
  if (ua.includes("githubcopilotchat") || openaiIntent === "conversation-panel" || initiator === "user") {
    return "github-copilot";
  }

  // Claude Code / Claude CLI
  if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") return "claude";

  // Gemini CLI
  if (ua.includes("gemini-cli")) return "gemini-cli";

  // Codex CLI / Desktop / VS Code (UA + originator variants from codex binary)
  if (
    ua.includes("codex-cli")
    || ua.includes("codex_cli_rs")
    || ua.includes("codex-tui")
    || ua.includes("codex_vscode")
    || ua.includes("codex_desktop")
    || (ua.includes("codex") && !ua.includes("githubcopilot"))
    || originator.includes("codex")
    || productSku === "codex"
    || openAiClient.includes("codex")
  ) {
    return "codex";
  }

  // DeepSeek TUI
  if (ua.includes("deepseek-tui")) return "deepseek-tui";

  return null;
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
