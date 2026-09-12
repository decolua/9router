// Ported from OmniRoute open-sse/services/webSearchFallback.ts (layer 1 of the native
// web_search redirect). Detects built-in server web-search tools (web_search,
// web_search_20250305, web_search_preview, ...) declared by clients like Claude Code and
// replaces them with a plain function tool that 9router executes itself through its /v1
// search providers instead of forwarding a server tool the upstream may not implement.
import { FORMATS } from "../translator/formats.js";
import { PROVIDERS } from "../config/providers.js";

export const NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME = "9router_web_search";
// Prefix match — Anthropic sends date-suffixed variants (web_search_20250305, ...).
const WEB_SEARCH_TOOL_TYPES = /^web_search/;
const SEARCH_CONTEXT_DEFAULTS = { low: 5, medium: 8, high: 10 };

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isBuiltInWebSearchTool(tool) {
  const toolRecord = toRecord(tool);
  const toolType = typeof toolRecord.type === "string" ? toolRecord.type : "";
  // A custom *function* tool that merely carries a `function` field is not the server tool.
  return WEB_SEARCH_TOOL_TYPES.test(toolType) && !toolRecord.function;
}

function isBuiltInWebSearchToolChoice(toolChoice) {
  const choice = toRecord(toolChoice);
  const toolType = typeof choice.type === "string" ? choice.type : "";
  return WEB_SEARCH_TOOL_TYPES.test(toolType);
}

function searchContextSize(tool) {
  return typeof tool.search_context_size === "string"
    ? tool.search_context_size.trim().toLowerCase()
    : "";
}

function buildFallbackDescription(tool) {
  const externalWebAccess = tool.external_web_access !== false;
  const defaultMaxResults =
    SEARCH_CONTEXT_DEFAULTS[searchContextSize(tool)] || SEARCH_CONTEXT_DEFAULTS.medium;
  const accessMode = externalWebAccess ? "public web" : "configured search index";
  return [
    `Search the ${accessMode} for recent, factual information and return cited results.`,
    "Use this when the answer depends on current events, external documents, or fresh facts.",
    `If max_results is omitted, prefer about ${defaultMaxResults} results.`,
  ].join(" ");
}

function buildFallbackParameters(tool) {
  const defaultMaxResults =
    SEARCH_CONTEXT_DEFAULTS[searchContextSize(tool)] || SEARCH_CONTEXT_DEFAULTS.medium;
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "The web search query to execute." },
      search_type: {
        type: "string",
        enum: ["web", "news"],
        description: "Use 'news' for recent headlines or reporting; otherwise use 'web'.",
      },
      max_results: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        default: defaultMaxResults,
        description: "Maximum number of results to retrieve.",
      },
      country: {
        type: "string",
        description: "Optional 2-letter country code for localization, e.g. US or BR.",
      },
      language: { type: "string", description: "Optional language code such as en or pt-BR." },
      time_range: {
        type: "string",
        enum: ["any", "day", "week", "month", "year"],
        description: "Optional recency filter.",
      },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          include_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of domains to include.",
          },
          exclude_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of domains to exclude.",
          },
        },
      },
    },
    required: ["query"],
  };
}

// This runs on the RAW client body before translation, so the injected tool must be built
// in the CLIENT (source) format shape — 9router translators do not understand server tools.
function buildFallbackTool(tool, sourceFormat) {
  const name = NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME;
  const description = buildFallbackDescription(tool);
  const parameters = buildFallbackParameters(tool);
  if (sourceFormat === FORMATS.CLAUDE) {
    return { name, description, input_schema: parameters };
  }
  // Responses API expects FLAT function tools, Chat Completions NESTED (OmniRoute #2390).
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return { type: "function", name, description, parameters };
  }
  return { type: "function", function: { name, description, parameters } };
}

function buildToolChoiceReplacement(sourceFormat) {
  const name = NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME;
  if (sourceFormat === FORMATS.CLAUDE) {
    return { type: "tool", name };
  }
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return { type: "function", name };
  }
  return { type: "function", function: { name } };
}

// True when the upstream natively runs the web_search server tool, so it must be forwarded
// untouched instead of converted to the 9router_web_search fallback.
export function supportsNativeWebSearchFallbackBypass({
  provider,
  sourceFormat,
  targetFormat,
  nativePassthrough,
}) {
  // Native client/provider passthrough (Claude Code -> Anthropic, Codex -> OpenAI): the
  // upstream runs web search itself.
  if (nativePassthrough) return true;
  // Deviation from OmniRoute: NO Gemini bypass — 9router's translator does not map the
  // built-in web_search tool to googleSearch, so Gemini targets get intercepted instead.
  // Claude -> Claude: Anthropic-format upstreams that actually implement typed server
  // tools (Anthropic itself, anthropic-compatible, or providers advertising the
  // claudeSupportedToolTypes quirk) run web_search_20250305 natively. Providers with a
  // Claude-format endpoint but no server-tool support (e.g. MiniMax 400s with error 2013)
  // must get the function fallback instead.
  if (sourceFormat === FORMATS.CLAUDE && targetFormat === FORMATS.CLAUDE) {
    if (provider === "anthropic" || (provider || "").startsWith("anthropic-compatible")) {
      return true;
    }
    const supportedTypes = PROVIDERS[provider]?.quirks?.claudeSupportedToolTypes;
    if (Array.isArray(supportedTypes) && supportedTypes.some((t) => WEB_SEARCH_TOOL_TYPES.test(String(t)))) {
      return true;
    }
    return false;
  }
  return false;
}

// Returns { body, fallback: { enabled, toolName, convertedToolCount} }. When enabled is
// true, `body` carries the rewritten tools/tool_choice and must replace the client body
// before translation; the caller also forces non-streaming so the intercept in
// chatCore/webSearchIntercept.js can rewrite the response.
export function prepareWebSearchFallbackBody(body, options) {
  const disabled = { enabled: false, toolName: null, convertedToolCount: 0 };
  const tools = Array.isArray(body.tools) ? body.tools : null;
  if (!tools || tools.length === 0) return { body, fallback: disabled };

  const builtInSearchTools = tools.filter(isBuiltInWebSearchTool);
  if (builtInSearchTools.length === 0) return { body, fallback: disabled };

  if (supportsNativeWebSearchFallbackBypass(options)) return { body, fallback: disabled };

  const toolNames = new Set();
  const preservedTools = tools.filter((tool) => {
    if (isBuiltInWebSearchTool(tool)) return false;
    const toolRecord = toRecord(tool);
    const functionRecord = toRecord(toolRecord.function);
    const name =
      typeof functionRecord.name === "string"
        ? functionRecord.name
        : typeof toolRecord.name === "string"
          ? toolRecord.name
          : "";
    if (name.trim().length > 0) toolNames.add(name.trim());
    return true;
  });

  if (!toolNames.has(NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME)) {
    preservedTools.unshift(buildFallbackTool(toRecord(builtInSearchTools[0]), options.sourceFormat));
  }

  const nextBody = { ...body, tools: preservedTools };
  if (isBuiltInWebSearchToolChoice(body.tool_choice)) {
    nextBody.tool_choice = buildToolChoiceReplacement(options.sourceFormat);
  }

  return {
    body: nextBody,
    fallback: {
      enabled: true,
      toolName: NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME,
      convertedToolCount: builtInSearchTools.length,
    },
  };
}
