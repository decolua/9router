// Layers 1+2 of the native web_search redirect: tool conversion (webSearchFallback.js)
// and whole-request routing (webSearchRouting.js). Pure functions, no mocks needed.
import { describe, expect, it } from "vitest";
import {
  NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME,
  prepareWebSearchFallbackBody,
  supportsNativeWebSearchFallbackBypass,
} from "open-sse/services/webSearchFallback.js";
import {
  hasNativeWebSearchTool,
  resolveWebSearchRouteOverride,
} from "open-sse/services/webSearchRouting.js";

const CLAUDE = "claude";
const OPENAI = "openai";
const RESPONSES = "openai-responses";

const nativeTool = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
const functionTool = { type: "function", function: { name: "web_search", parameters: {} } };

function claudeBody(extra = {}) {
  return {
    model: "minimax/minimax-m2",
    messages: [{ role: "user", content: "hi" }],
    tools: [functionTool, { ...nativeTool }],
    ...extra,
  };
}

describe("prepareWebSearchFallbackBody (layer 1)", () => {
  it("converts the built-in web_search tool into the fallback function tool for a Claude client", () => {
    const body = claudeBody();
    const { body: next, fallback } = prepareWebSearchFallbackBody(body, {
      provider: "minimax", sourceFormat: CLAUDE, targetFormat: CLAUDE, nativePassthrough: false,
    });
    expect(fallback.enabled).toBe(true);
    expect(fallback.toolName).toBe(NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME);
    expect(fallback.convertedToolCount).toBe(1);
    expect(next.tools).toHaveLength(2);
    const injected = next.tools[0];
    expect(injected.name).toBe(NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME);
    expect(injected.input_schema.properties.query.type).toBe("string");
    // untouched: the custom function tool named web_search stays
    expect(next.tools[1]).toBe(functionTool);
  });

  it("maps search_context_size to a default max_results", () => {
    const body = { ...claudeBody(), tools: [{ type: "web_search", search_context_size: "high" }] };
    const { body: next } = prepareWebSearchFallbackBody(body, {
      provider: "minimax", sourceFormat: CLAUDE, targetFormat: OPENAI, nativePassthrough: false,
    });
    expect(next.tools[0].input_schema.properties.max_results.default).toBe(10);
  });

  it("replaces a built-in web_search tool_choice", () => {
    const body = claudeBody({ tool_choice: { type: "web_search_20250305" } });
    const { body: next, fallback } = prepareWebSearchFallbackBody(body, {
      provider: "minimax", sourceFormat: CLAUDE, targetFormat: OPENAI, nativePassthrough: false,
    });
    expect(fallback.enabled).toBe(true);
    expect(next.tool_choice).toEqual({ type: "tool", name: NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME });
  });

  it("leaves the body untouched when the target runs web search natively", () => {
    const body = claudeBody();
    for (const opts of [
      { provider: "anthropic", sourceFormat: CLAUDE, targetFormat: CLAUDE, nativePassthrough: true },
      { provider: "anthropic", sourceFormat: CLAUDE, targetFormat: CLAUDE, nativePassthrough: false },
    ]) {
      const { body: next, fallback } = prepareWebSearchFallbackBody(body, opts);
      expect(fallback.enabled).toBe(false);
      expect(next).toBe(body);
    }
  });

  it("emits the injected tool in the client format (Responses flat, Chat nested)", () => {
    const responsesBody = { tools: [{ type: "web_search_preview" }] };
    const flat = prepareWebSearchFallbackBody(responsesBody, {
      provider: "gemini", sourceFormat: RESPONSES, targetFormat: RESPONSES, nativePassthrough: false,
    }).body.tools[0];
    expect(flat.type).toBe("function");
    expect(flat.name).toBe(NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME);
    expect(flat.parameters).toBeDefined();

    const chatBody = { tools: [{ type: "function", function: { name: "x" } }] };
    // no native tool -> disabled
    expect(prepareWebSearchFallbackBody(chatBody, {
      provider: "kimi", sourceFormat: OPENAI, targetFormat: OPENAI, nativePassthrough: false,
    }).fallback.enabled).toBe(false);
  });

  it("does not treat a custom function tool named web_search as the built-in", () => {
    const body = { tools: [functionTool] };
    const { fallback } = prepareWebSearchFallbackBody(body, {
      provider: "kimi", sourceFormat: OPENAI, targetFormat: OPENAI, nativePassthrough: false,
    });
    expect(fallback.enabled).toBe(false);
  });

  it("skips conversion when the tool is scoped with external_web_access:false", () => {
    // Routing a non-public search through external providers would break the scope,
    // so the whole request is left for the upstream to handle.
    const body = { tools: [{ ...nativeTool, external_web_access: false }] };
    const { body: next, fallback } = prepareWebSearchFallbackBody(body, {
      provider: "minimax", sourceFormat: CLAUDE, targetFormat: OPENAI, nativePassthrough: false,
    });
    expect(fallback.enabled).toBe(false);
    expect(next).toBe(body);
  });

  it("skips conversion when the client already owns the reserved fallback tool name", () => {
    // Converting anyway would make the interceptor run the client's own tool as a search.
    const ownedByClient = { type: "function", function: { name: NINEROUTER_WEB_SEARCH_FALLBACK_TOOL_NAME, parameters: {} } };
    const body = { tools: [{ ...nativeTool }, ownedByClient] };
    const { body: next, fallback } = prepareWebSearchFallbackBody(body, {
      provider: "minimax", sourceFormat: CLAUDE, targetFormat: OPENAI, nativePassthrough: false,
    });
    expect(fallback.enabled).toBe(false);
    expect(next).toBe(body);
  });
});

describe("supportsNativeWebSearchFallbackBypass", () => {
  it("never bypasses Gemini targets (9router translator does not map web_search)", () => {
    expect(supportsNativeWebSearchFallbackBypass({
      provider: "gemini", sourceFormat: OPENAI, targetFormat: OPENAI, nativePassthrough: false,
    })).toBe(false);
  });
});

describe("resolveWebSearchRouteOverride (layer 2)", () => {
  it("detects only native server tools", () => {
    expect(hasNativeWebSearchTool({ tools: [{ type: "web_search_20250305" }] })).toBe(true);
    expect(hasNativeWebSearchTool({ tools: [functionTool] })).toBe(false);
    expect(hasNativeWebSearchTool({})).toBe(false);
  });

  it("routes the whole request when webSearchRouteModel is set and different", () => {
    const body = { tools: [{ type: "web_search" }] };
    const route = resolveWebSearchRouteOverride("minimax/m2", body, { webSearchRouteModel: "anthropic/claude-opus-4-6" });
    expect(route).toEqual({ wasRouted: true, model: "anthropic/claude-opus-4-6" });
  });

  it("falls through without the tool, without config, or when already routed", () => {
    const body = { tools: [{ type: "web_search" }] };
    expect(resolveWebSearchRouteOverride("m", body, {}).wasRouted).toBe(false);
    expect(resolveWebSearchRouteOverride("m", {}, { webSearchRouteModel: "x" }).wasRouted).toBe(false);
    expect(resolveWebSearchRouteOverride("x", body, { webSearchRouteModel: "x" }).wasRouted).toBe(false);
  });
});
