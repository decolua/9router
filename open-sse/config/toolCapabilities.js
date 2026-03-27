// Tool capability map — which providers support which built-in tools natively
//
// Built-in tools are server-side tools handled by the provider itself
// (e.g. Anthropic's web_search_20250305). When a request includes a built-in
// tool and the target provider doesn't support it, 9router needs to decide
// what to do: strip it, translate it, or route it elsewhere.
//
// This module is the single source of truth for that decision.

// Tools that providers handle server-side (not user-defined function tools)
export const BUILT_IN_TOOLS = {
  WEB_SEARCH: "web_search_20250305",
  WEB_FETCH: "web_fetch_20250305",
};

// Which providers support which built-in tools natively
// Key = provider ID (from providers.js), value = set of supported tool types
//
// Categories:
//   PASS-THROUGH: provider accepts the Anthropic tool format directly
//   IMPLICIT:     provider does web search on all queries (no tool needed)
//   NATIVE:       provider has its own web search but in a DIFFERENT format
//                 (translation needed — not yet implemented, see FUTURE_TRANSLATABLE)
//   NONE:         provider has no web search capability
const PROVIDER_TOOL_SUPPORT = {
  // --- PASS-THROUGH (Anthropic-compatible, accept web_search_20250305 as-is) ---
  claude: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  anthropic: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  // Claude-compatible API proxies that pass through to Anthropic backends
  glm: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  kimi: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  minimax: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  "minimax-cn": new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  "kimi-coding": new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
};

// Providers with native web search in a DIFFERENT format.
// These could theoretically translate Anthropic web_search into their native
// format, but that translation is not yet implemented.
//
// When implemented, these providers would move from "strip + notify" to
// "translate and pass through" behavior.
//
// Provider          | Native format                              | Notes
// -----------------|--------------------------------------------|------
// gemini           | tools: [{ google_search: {} }]             | Google Search grounding via GenerateContent API
// gemini-cli       | same as gemini                             | Cloud Code uses same Gemini API
// antigravity      | same as gemini                             | Google's tool, uses Gemini backend
// vertex           | same as gemini                             | Vertex AI Gemini models
// xai              | tools: [{ type: "web_search" }]            | Grok web_search via /v1/responses
// perplexity       | implicit (all queries search the web)      | No tool needed — Sonar models always search
// openai           | tools: [{ type: "web_search" }]            | Only in Responses API, not chat completions
// codex            | tools: [{ type: "web_search" }]            | Uses OpenAI Responses API format
// cohere           | connectors (external RAG setup)            | Not a simple tool — requires connector config
//
// NOT translatable (no native web search):
// deepseek, groq, mistral, together, fireworks, cerebras, nvidia,
// github (Copilot), kiro, cursor, ollama, nebius, siliconflow,
// hyperbolic, alicode, alicode-intl, glm-cn, openrouter, kilocode,
// opencode, cline, nanobanana, chutes, vertex-partner, qwen, iflow
export const FUTURE_TRANSLATABLE = {
  gemini: { tool: "google_search", format: "gemini" },
  "gemini-cli": { tool: "google_search", format: "gemini" },
  antigravity: { tool: "google_search", format: "gemini" },
  vertex: { tool: "google_search", format: "gemini" },
  xai: { tool: "web_search", format: "xai-responses" },
  perplexity: { tool: null, format: "implicit" },
  openai: { tool: "web_search", format: "openai-responses" },
  codex: { tool: "web_search", format: "openai-responses" },
};

/**
 * Check if a provider supports a specific built-in tool natively.
 * @param {string} provider - Provider ID (e.g. "claude", "openai", "gemini")
 * @param {string} toolType - Tool type string (e.g. "web_search_20250305")
 * @returns {boolean}
 */
export function supportsBuiltInTool(provider, toolType) {
  const supported = PROVIDER_TOOL_SUPPORT[provider];
  return supported ? supported.has(toolType) : false;
}

/**
 * Check if a tool is a built-in tool (not a user-defined function tool).
 * Built-in tools have a `type` field that is NOT "function".
 * @param {object} tool - Tool object from the request
 * @returns {boolean}
 */
export function isBuiltInTool(tool) {
  return !!(tool.type && tool.type !== "function");
}

/**
 * Get all built-in tools from a tools array.
 * @param {Array} tools - Tools array from request body
 * @returns {Array} Built-in tools found
 */
export function extractBuiltInTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.filter(isBuiltInTool);
}

/**
 * Get the names of unsupported built-in tools for a given provider.
 * @param {string} provider - Provider ID
 * @param {Array} tools - Tools array from request body
 * @returns {string[]} Names/types of unsupported built-in tools
 */
export function getUnsupportedBuiltInTools(provider, tools) {
  if (!Array.isArray(tools)) return [];
  const builtIn = extractBuiltInTools(tools);
  return builtIn
    .filter(tool => !supportsBuiltInTool(provider, tool.type || tool.name))
    .map(tool => tool.type || tool.name);
}
