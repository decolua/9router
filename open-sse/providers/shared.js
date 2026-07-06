// Use process.platform / process.arch instead of node:os. This module is
// imported transitively by the client-side provider registry
// (registry -> claude.js -> shared.js); importing node:os in a client chunk
// triggers Vite's "externalized for browser compatibility" error. `process`
// is a global shimmed by Vite/vinext, so there is no module import to
// externalize. The values are identical (process.platform === os.platform(),
// process.arch === os.arch()) on the server, and `undefined` in the browser
// (the getters below are only ever read server-side, at request time).

// === OS/Arch helpers (Stainless fingerprint) ===
export function mapStainlessOs() {
  const p = process.platform;
  switch (p) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${p}`;
  }
}

export function mapStainlessArch() {
  const a = process.arch;
  switch (a) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${a}`;
  }
}

// Anthropic API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint — required by providers that gate on client identity (e.g. agentrouter)
// The os-derived fields (X-Stainless-Arch/Os) use getters so the module can be
// imported by client code without touching node:os; the values resolve on first
// access (server-side, at request time).
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2026-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.80.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  get "X-Stainless-Arch"() { return mapStainlessArch(); },
  get "X-Stainless-Os"() { return mapStainlessOs(); },
  "X-Stainless-Timeout": "600"
};

// Shared baseUrls
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

// Default base for dynamic compat providers (openai-compatible-* / anthropic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

// Antigravity OAuth client credentials (public CLI client — duplicated in usage.js + src/lib/oauth)
export const ANTIGRAVITY_OAUTH_CLIENT = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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"
};

// Gemini (Google) OAuth client credentials (public CLI client — shared by gemini, gemini-cli, src/lib/oauth)
export const GOOGLE_OAUTH_CLIENT = {
  clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  clientSecret: "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"
};
