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
  // --- PASS-THROUGH (Anthropic servers, accept web_search_20250305 as-is) ---
  claude: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  anthropic: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  // Note: glm, kimi, minimax use Claude wire format but their backends are NOT
  // Anthropic — they have their own model-driven search or no search at all.
  // Do NOT add them here; they go in FUTURE_TRANSLATABLE or get stripped.
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
// gemini           | tools: [{ googleSearch: {} }]              | Google Search grounding
// gemini-cli       | same as gemini                             | Cloud Code uses same Gemini API
// antigravity      | same as gemini                             | Google's tool, uses Gemini backend
// vertex           | same as gemini                             | Vertex AI Gemini models
// xai              | tools: [{ type: "web_search" }]            | Grok web_search via /v1/responses
// perplexity       | web_search_options: {} (automatic)          | Sonar models always search, can configure
// openai           | tools: [{ type: "web_search_preview" }]    | Responses API only, not chat completions
// groq             | model: "groq/compound" (automatic)          | Server-side search on compound models
// qwen             | enable_search: true (DashScope param)       | Alibaba DashScope API specific
// mistral          | tools: [{ type: "web_search" }]            | Agents API only, not chat completions
// openrouter       | plugins: [{ type: "web_search" }]          | Plugin system, works across models
// glm              | model-driven agentic tool use               | GLM-4.5/4.7 have browsing capabilities
// kimi             | model-native search/browse                  | K2/K2.5 have built-in search + browsing
//
// NOT translatable (no native web search):
// deepseek, together, fireworks, cerebras, nvidia, github (Copilot),
// kiro, cursor, ollama-local, nebius, siliconflow, hyperbolic,
// alicode, alicode-intl, glm-cn, kilocode, opencode, cline,
// nanobanana, chutes, vertex-partner, iflow, minimax, minimax-cn,
// kimi-coding
//
// DEPRECATED web search:
// cohere — connectors removed September 2025
// codex — OpenAI explicitly does NOT support web_search on codex models
export const FUTURE_TRANSLATABLE = {
  gemini: { tool: "googleSearch", format: "gemini" },
  "gemini-cli": { tool: "googleSearch", format: "gemini" },
  antigravity: { tool: "googleSearch", format: "gemini" },
  vertex: { tool: "googleSearch", format: "gemini" },
  xai: { tool: "web_search", format: "xai-responses" },
  perplexity: { tool: null, format: "implicit" },
  openai: { tool: "web_search_preview", format: "openai-responses" },
  groq: { tool: null, format: "compound-model" },
  qwen: { tool: null, format: "dashscope-param" },
  mistral: { tool: "web_search", format: "agents-api" },
  openrouter: { tool: "web_search", format: "plugins" },
  glm: { tool: null, format: "model-agentic" },
  kimi: { tool: null, format: "model-native" },
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
