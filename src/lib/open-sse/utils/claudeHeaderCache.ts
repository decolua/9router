/**
 * Singleton cache for real Claude Code client headers.
 */

const CLAUDE_IDENTITY_HEADERS = [
  "user-agent",
  "anthropic-beta",
  "anthropic-version",
  "anthropic-dangerous-direct-browser-access",
  "x-app",
  "x-stainless-helper-method",
  "x-stainless-retry-count",
  "x-stainless-runtime-version",
  "x-stainless-package-version",
  "x-stainless-runtime",
  "x-stainless-lang",
  "x-stainless-arch",
  "x-stainless-os",
  "x-stainless-timeout",
  "x-claude-code-session-id",
  "package-version",
  "runtime-version",
  "os",
  "arch",
];

let cachedHeaders: Record<string, string> | null = null;

/**
 * Detect if request headers look like a real Claude Code client.
 */
function isClaudeCodeClient(headers: Record<string, string>): boolean {
  const ua = (headers["user-agent"] || "").toLowerCase();
  const xApp = (headers["x-app"] || "").toLowerCase();
  return ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli";
}

/**
 * Store Claude Code identity headers if this looks like a real client request.
 */
export function cacheClaudeHeaders(headers: Record<string, string>): void {
  if (!headers || typeof headers !== "object") return;
  if (!isClaudeCodeClient(headers)) return;

  const captured: Record<string, string> = {};
  for (const key of CLAUDE_IDENTITY_HEADERS) {
    if (headers[key] !== undefined && headers[key] !== null) {
      captured[key] = headers[key];
    }
  }

  if (Object.keys(captured).length > 0) {
    cachedHeaders = captured;
    console.log(`[ClaudeHeaders] Cached ${Object.keys(captured).length} identity headers from Claude Code client`);
  }
}

/**
 * Get the most recently cached Claude Code identity headers.
 */
export function getCachedClaudeHeaders(): Record<string, string> | null {
  return cachedHeaders;
}
