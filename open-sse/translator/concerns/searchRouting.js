import { FORMATS } from "../formats.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK } from "../schema/index.js";
import { PROVIDERS } from "../../config/providers.js";

export const ANTHROPIC_SEARCH_TYPE = "web_search_20250305";

export function isAnthropicSearch(tool) {
  return typeof tool?.type === "string" && /^web_search_\d{8}$/.test(tool.type);
}

// Use the same native-search decision when validating a route and preparing its tools.
export function supportsAnthropicSearch(provider, type) {
  if (provider === "claude" || provider === "anthropic" || provider?.startsWith("anthropic-compatible")) {
    return true;
  }
  return PROVIDERS[provider]?.quirks?.claudeSupportedToolTypes?.includes(type) === true;
}

function hasSyntheticResult(message) {
  if (!Array.isArray(message.content)) {
    return false;
  }
  return message.content.some(block => {
    if (block?.type !== CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT || !Array.isArray(block.content)) {
      return false;
    }
    return block.content.some(result =>
      result?.type === CLAUDE_BLOCK.WEB_SEARCH_RESULT && !result.encrypted_content
    );
  });
}

function unsupportedCodexOption(tool) {
  for (const [key, value] of Object.entries(tool)) {
    if (["type", "name", "max_uses"].includes(key)) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    return true;
  }
  return tool.max_uses !== undefined && (!Number.isInteger(tool.max_uses) || tool.max_uses <= 0);
}

// Reject search conversions before dispatch rather than silently drop client controls or evidence.
export function validateSearchRoute(body, source, target, provider, model, log) {
  if (source !== FORMATS.CLAUDE) {
    return null;
  }
  if (target === FORMATS.CLAUDE && body.messages?.some(hasSyntheticResult)) {
    return "Search history from a non-Anthropic provider has no Anthropic encrypted payload. Start a new conversation before switching to a native Anthropic route.";
  }
  const declarations = Array.isArray(body.tools) ? body.tools : [];
  const tools = declarations.filter(isAnthropicSearch);
  if (tools.length === 0) {
    return null;
  }
  if (provider === "codex" && target === FORMATS.OPENAI_RESPONSES && tools.every(tool => tool.type === ANTHROPIC_SEARCH_TYPE)) {
    if (tools.some(unsupportedCodexOption)) {
      return "Codex native search does not support these search restrictions or an invalid max_uses budget.";
    }
    log?.warn?.("SEARCH", "Codex native search cannot enforce Anthropic max_uses; upstream search execution is unbounded.");
    return null;
  }
  if (target === FORMATS.CLAUDE && tools.every(tool => supportsAnthropicSearch(provider, tool.type))) {
    return null;
  }
  return `Native Anthropic web search is not supported on the ${provider}/${model} route (${source} → ${target}). Use a route that supports Anthropic web search or a separate search tool.`;
}

function declaresFunction(tools, name) {
  for (const tool of tools || []) {
    if (tool?.type === "namespace") {
      if (declaresFunction(tool.tools, name)) {
        return true;
      }
      continue;
    }
    if (tool?.type === OPENAI_BLOCK.FUNCTION && (tool.name || tool.function?.name) === name) {
      return true;
    }
  }
  return false;
}

function hasForcedDeclaration(body, name) {
  if (declaresFunction(body.tools, name)) {
    return true;
  }
  if (!Array.isArray(body.input)) {
    return false;
  }
  return body.input.some(item => item?.type === "additional_tools" && declaresFunction(item.tools, name));
}

// Reject unmatched forced functions before an executor can drop the choice and default to auto.
export function validateForcedFunction(body) {
  const choice = body.tool_choice;
  if (choice?.type !== OPENAI_BLOCK.FUNCTION) {
    return null;
  }
  const name = choice.name || choice.function?.name;
  const declared = hasForcedDeclaration(body, name);
  if (!name || !declared) {
    return "Forced function choice does not match a declared tool.";
  }
  return null;
}

export function hasHostedSearch(tools) {
  return Array.isArray(tools) && tools.some(tool => tool?.type === OPENAI_BLOCK.WEB_SEARCH || isAnthropicSearch(tool));
}
