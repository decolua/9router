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
const PROVIDER_TOOL_SUPPORT = {
  claude: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  anthropic: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  // Providers using Claude-compatible APIs that pass through to Anthropic
  glm: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  kimi: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  minimax: new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  "minimax-cn": new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
  "kimi-coding": new Set([BUILT_IN_TOOLS.WEB_SEARCH, BUILT_IN_TOOLS.WEB_FETCH]),
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
