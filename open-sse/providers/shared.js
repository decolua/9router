import { platform, arch } from "os";

// === OS/Arch helpers (Stainless fingerprint) ===
export function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

export function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

// Anthropic API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const CLAUDE_CLI_VERSION = "2.1.280";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Full Claude CLI fingerprint — required by providers that gate on client identity (e.g. agentrouter)
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.80.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

const ANTHROPIC_BETA_BASE = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

// Heavy-agent beta flags are gated to opus/sonnet — cheaper models don't need them.
// `redact-thinking` asks Anthropic to return signature-only thinking blocks, which
// is right for clients that never render thinking but blanks the summaries a
// client explicitly requested with `thinking.display: "summarized"`.
const ANTHROPIC_BETA_REDACT_THINKING = "redact-thinking-2026-02-12";

export function wantsThinkingSummaries(body) {
  return body?.thinking?.display === "summarized";
}

// Feature-driven beta flags, mirroring the AI SDK Anthropic provider
// (anthropic-language-model.ts header assembly + anthropic-prepare-tools.ts).
// Only flags for features present in the wire body are added on top of the base set.
function featureBetas(body) {
  const betas = new Set();
  if (!body || typeof body !== "object") return betas;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const toolType = (t) => (t && typeof t.type === "string" ? t.type : "");
  const hasToolType = (re) => tools.some((t) => re.test(toolType(t)));
  const toolHas = (key) => tools.some((t) => t && typeof t === "object" && t[key] !== undefined);

  if ((Array.isArray(body.mcp_servers) && body.mcp_servers.length > 0) || hasToolType(/^mcp/i)) {
    betas.add("mcp-client-2025-04-04");
  }
  if (Array.isArray(body.safeguards) && body.safeguards.length > 0) {
    betas.add("dangerous-tool-use-2026-09-03");
  }
  if (body.compaction && typeof body.compaction === "object") {
    betas.add("compact-2026-09-04");
  }
  const ctxEdits = body.context_management?.edits || body.contextManagement?.edits;
  if (Array.isArray(ctxEdits) && ctxEdits.some((e) => e?.type === "compact_20260112")) {
    betas.add("compact-2026-01-12");
  }
  if (body.container && typeof body.container === "object"
      && Array.isArray(body.container.skills) && body.container.skills.length > 0) {
    betas.add("code-execution-2025-08-25");
    betas.add("skills-2025-10-02");
    betas.add("files-api-2025-04-14");
  }
  if (body.task_budget !== undefined || body.taskBudget !== undefined) {
    betas.add("task-budgets-2026-03-13");
  }
  if (body.speed === "fast") {
    betas.add("fast-mode-2026-02-01");
  }
  if (body.thinking?.display === "updates") {
    betas.add("thinking-display-updates-2026-08-18");
  }
  if (body.thinking?.blockBinding != null || body.thinking?.block_binding != null) {
    betas.add("thinking-binding-controls-2026-08-01");
  }
  if (body.fallbacks === "default") {
    betas.add("server-side-fallback-2026-07-01");
  } else if (Array.isArray(body.fallbacks) && body.fallbacks.length > 0) {
    betas.add("server-side-fallback-2026-06-01");
  }
  if (body.effort !== undefined || body.output_config?.effort !== undefined) {
    betas.add("effort-2025-11-24");
  }
  if (body.output_config?.format?.type === "json_schema" || tools.some((t) => t?.strict === true)) {
    betas.add("structured-outputs-2025-11-13");
  }
  if (toolHas("input_examples") || toolHas("allowed_callers") || toolHas("defer_loading")) {
    betas.add("advanced-tool-use-2025-11-20");
  }
  if (hasToolType(/code_execution_20250522/)) {
    betas.add("code-execution-2025-05-22");
  }
  if (hasToolType(/code_execution/)) {
    betas.add("code-execution-2025-08-25");
  }
  if (hasToolType(/computer/)) {
    betas.add("computer-use-2025-01-24");
  }
  if (hasToolType(/web_fetch/)) {
    betas.add("web-fetch-2025-09-10");
  }
  let midSystem = false;
  let toolChange = false;
  let clearAt = false;
  const scanBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_addition" || b.type === "tool_removal") toolChange = true;
      if (b.clearAt !== undefined || b.clear_at !== undefined) clearAt = true;
    }
  };
  scanBlocks(body.system);
  for (const m of messages) {
    if (m?.role === "system") midSystem = true;
    scanBlocks(m?.content);
  }
  if (midSystem) {
    betas.add("mid-conversation-system-2026-04-07");
    if (body.output_config?.effort !== undefined) {
      betas.add("mid-conversation-output-config-2026-07-01");
    }
  }
  if (toolChange) {
    betas.add("mid-conversation-tool-changes-2026-07-01");
  }
  if (clearAt) {
    betas.add("mid-conversation-system-clear-at-2026-08-21");
  }
  return betas;
}

export function selectAnthropicBeta(model = "", body = null) {
  const flags = ANTHROPIC_BETA_BASE.filter((flag) => flag !== ANTHROPIC_BETA_REDACT_THINKING || !wantsThinkingSummaries(body));
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  const seen = new Set(flags);
  for (const beta of featureBetas(body)) {
    if (!seen.has(beta)) {
      seen.add(beta);
      flags.push(beta);
    }
  }
  return flags.join(",");
}

// Parse a caller-supplied anthropic-beta header value into individual flags.
export function getBetasFromHeaders(headers) {
  if (!headers || typeof headers !== "object") return [];
  const out = [];
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== "anthropic-beta" || typeof value !== "string") continue;
    for (const part of value.split(",")) {
      const beta = part.trim().toLowerCase();
      if (beta && !out.includes(beta)) out.push(beta);
    }
  }
  return out;
}

// Union selected flags with caller-supplied ones, deduplicated. Returns the header value.
export function mergeBetas(selected, userBetas) {
  const base = Array.isArray(selected) ? selected : String(selected || "").split(",");
  const extra = Array.isArray(userBetas) ? userBetas : (userBetas != null ? [userBetas] : []);
  const seen = new Set();
  const out = [];
  for (const raw of [...base, ...extra]) {
    const beta = String(raw || "").trim();
    const key = beta.toLowerCase();
    if (beta && !seen.has(key)) {
      seen.add(key);
      out.push(beta);
    }
  }
  return out.join(",");
}

// Backward-compat alias: historical variadic comma-list union (tests + DefaultExecutor).
// Case-insensitive dedupe, consistent with mergeBetas.
export function mergeAnthropicBeta(...values) {
  const flags = values
    .flatMap((v) => (Array.isArray(v) ? v : String(v ?? "").split(",")))
    .map((f) => String(f || "").trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const f of flags) {
    const key = f.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  return out.join(",");
}

// Shared baseUrls
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

// Default base for dynamic compat providers (openai-compatible-* / anthropic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

// Official Antigravity IDE Desktop 2.11.0 fingerprint captured from macOS arm64.
// Keep this static even when 9router runs on Linux: the provider profile is
// intentionally matching the IDE client, not the server host.
export const ANTIGRAVITY_IDE_VERSION = "2.11.0";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

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
