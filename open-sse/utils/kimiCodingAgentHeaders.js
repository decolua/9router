import { arch, platform } from "os";

const CODING_AGENT_PATTERNS = [
  { id: "claude-code", test: (ua, headers) => ua.includes("claude-cli") || ua.includes("claude-code") || headers["x-app"] === "cli" },
  { id: "roo-code", test: (ua) => ua.includes("roo-code") || ua.includes("roocode") },
  { id: "opencode", test: (ua) => ua.includes("opencode") || ua.includes("open-code") },
  { id: "openclaw", test: (ua) => ua.includes("openclaw") || ua.includes("open-claw") },
  { id: "hermes", test: (ua) => ua.includes("hermes") },
  { id: "kilo-code", test: (ua) => ua.includes("kilo-code") || ua.includes("kilocode") },
  { id: "cline", test: (ua) => ua.includes("cline") },
];

const KIMI_AGENT_HEADER_ALLOWLIST = [
  "user-agent",
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
  "anthropic-beta",
  "anthropic-version",
  "anthropic-dangerous-direct-browser-access",
];

const KIMI_OPENAI_COMPAT_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advanced-tool-use-2025-11-20",
  "effort-2025-11-24",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
].join(",");

function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null) continue;
    normalized[String(key).toLowerCase()] = String(value);
  }
  return normalized;
}

export function detectKimiCodingAgent(headers = {}) {
  const normalized = normalizeHeaders(headers);
  const ua = (normalized["user-agent"] || "").toLowerCase();
  return CODING_AGENT_PATTERNS.find((agent) => agent.test(ua, normalized))?.id || null;
}

export function buildKimiCodingAgentHeaders(headers = {}) {
  const normalized = normalizeHeaders(headers);
  const agent = detectKimiCodingAgent(normalized);
  if (!agent) return { agent: null, headers: {} };

  const forwarded = {};
  for (const key of KIMI_AGENT_HEADER_ALLOWLIST) {
    const value = normalized[key];
    if (!value || value.length > 1024) continue;
    forwarded[key] = value;
  }
  return { agent, headers: forwarded };
}

export function buildKimiOpenAICompatibilityHeaders(headers = {}) {
  const realAgent = buildKimiCodingAgentHeaders(headers);
  if (realAgent.agent) return realAgent;

  return {
    agent: "openai-compat",
    headers: {
      "user-agent": "claude-cli/2.1.143 (external, sdk-cli)",
      "x-app": "cli",
      "x-stainless-helper-method": "stream",
      "x-stainless-retry-count": "0",
      "x-stainless-runtime-version": process.version,
      "x-stainless-package-version": "0.80.0",
      "x-stainless-runtime": "node",
      "x-stainless-lang": "js",
      "x-stainless-arch": mapStainlessArch(),
      "x-stainless-os": mapStainlessOs(),
      "x-stainless-timeout": "600",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": KIMI_OPENAI_COMPAT_BETA,
      "anthropic-dangerous-direct-browser-access": "true",
    },
  };
}
