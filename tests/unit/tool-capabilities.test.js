/**
 * Unit tests for tool capability awareness
 *
 * Tests cover:
 *  - Tool capability map correctness
 *  - Built-in tool detection
 *  - Unsupported tool identification per provider
 *  - Integration with claudeHelper.prepareClaudeRequest
 *  - Integration with translator index for OpenAI-format targets
 */

import { describe, it, expect } from "vitest";
import {
  supportsBuiltInTool,
  isBuiltInTool,
  extractBuiltInTools,
  getUnsupportedBuiltInTools,
  BUILT_IN_TOOLS,
  FUTURE_TRANSLATABLE,
} from "../../open-sse/config/toolCapabilities.js";

describe("Tool Capabilities", () => {
  describe("BUILT_IN_TOOLS constants", () => {
    it("should define web_search and web_fetch", () => {
      expect(BUILT_IN_TOOLS.WEB_SEARCH).toBe("web_search_20250305");
      expect(BUILT_IN_TOOLS.WEB_FETCH).toBe("web_fetch_20250305");
    });
  });

  describe("supportsBuiltInTool", () => {
    it("should return true for Claude provider with web_search", () => {
      expect(supportsBuiltInTool("claude", BUILT_IN_TOOLS.WEB_SEARCH)).toBe(true);
    });

    it("should return true for Claude provider with web_fetch", () => {
      expect(supportsBuiltInTool("claude", BUILT_IN_TOOLS.WEB_FETCH)).toBe(true);
    });

    it("should return true for anthropic provider with web_search", () => {
      expect(supportsBuiltInTool("anthropic", BUILT_IN_TOOLS.WEB_SEARCH)).toBe(true);
    });

    it("should return true for Claude-compatible providers", () => {
      for (const provider of ["glm", "kimi", "minimax", "minimax-cn", "kimi-coding"]) {
        expect(supportsBuiltInTool(provider, BUILT_IN_TOOLS.WEB_SEARCH)).toBe(true);
      }
    });

    it("should return false for OpenAI provider", () => {
      expect(supportsBuiltInTool("openai", BUILT_IN_TOOLS.WEB_SEARCH)).toBe(false);
    });

    it("should return false for providers not in the map", () => {
      for (const provider of ["gemini", "github", "nvidia", "deepseek", "groq", "xai"]) {
        expect(supportsBuiltInTool(provider, BUILT_IN_TOOLS.WEB_SEARCH)).toBe(false);
      }
    });

    it("should return false for unknown tool types", () => {
      expect(supportsBuiltInTool("claude", "unknown_tool_v1")).toBe(false);
    });

    it("should return false for unknown providers", () => {
      expect(supportsBuiltInTool("nonexistent", BUILT_IN_TOOLS.WEB_SEARCH)).toBe(false);
    });
  });

  describe("isBuiltInTool", () => {
    it("should identify built-in tools by type", () => {
      expect(isBuiltInTool({ type: "web_search_20250305" })).toBe(true);
      expect(isBuiltInTool({ type: "web_fetch_20250305" })).toBe(true);
    });

    it("should not flag function tools as built-in", () => {
      expect(isBuiltInTool({ type: "function", function: { name: "my_tool" } })).toBe(false);
    });

    it("should not flag tools without type as built-in", () => {
      expect(isBuiltInTool({ name: "my_tool", description: "test" })).toBe(false);
    });
  });

  describe("extractBuiltInTools", () => {
    it("should extract only built-in tools from mixed array", () => {
      const tools = [
        { type: "web_search_20250305", max_uses: 3 },
        { type: "function", function: { name: "read_file" } },
        { type: "web_fetch_20250305" },
        { name: "custom_tool", description: "test", input_schema: {} },
      ];
      const result = extractBuiltInTools(tools);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("web_search_20250305");
      expect(result[1].type).toBe("web_fetch_20250305");
    });

    it("should return empty array for no built-in tools", () => {
      const tools = [
        { type: "function", function: { name: "read_file" } },
      ];
      expect(extractBuiltInTools(tools)).toHaveLength(0);
    });

    it("should handle null/undefined input", () => {
      expect(extractBuiltInTools(null)).toHaveLength(0);
      expect(extractBuiltInTools(undefined)).toHaveLength(0);
    });
  });

  describe("getUnsupportedBuiltInTools", () => {
    const toolsWithWebSearch = [
      { type: "web_search_20250305", max_uses: 3 },
      { type: "function", function: { name: "read_file" } },
    ];

    it("should return empty for Claude (supports web_search)", () => {
      expect(getUnsupportedBuiltInTools("claude", toolsWithWebSearch)).toHaveLength(0);
    });

    it("should return web_search for OpenAI (does not support it)", () => {
      const result = getUnsupportedBuiltInTools("openai", toolsWithWebSearch);
      expect(result).toEqual(["web_search_20250305"]);
    });

    it("should return web_search for Gemini", () => {
      const result = getUnsupportedBuiltInTools("gemini", toolsWithWebSearch);
      expect(result).toEqual(["web_search_20250305"]);
    });

    it("should return multiple unsupported tools", () => {
      const tools = [
        { type: "web_search_20250305" },
        { type: "web_fetch_20250305" },
        { type: "function", function: { name: "tool" } },
      ];
      const result = getUnsupportedBuiltInTools("openai", tools);
      expect(result).toHaveLength(2);
      expect(result).toContain("web_search_20250305");
      expect(result).toContain("web_fetch_20250305");
    });

    it("should not include function tools as unsupported", () => {
      const tools = [
        { type: "function", function: { name: "my_tool" } },
      ];
      expect(getUnsupportedBuiltInTools("openai", tools)).toHaveLength(0);
    });
  });
});

describe("Tool stripping with system message injection", () => {
  // Test the actual prepareClaudeRequest behavior
  describe("prepareClaudeRequest - Claude format targets", () => {
    // Dynamic import to handle module loading
    let prepareClaudeRequest;

    it("should preserve built-in tools for Claude provider", async () => {
      const mod = await import("../../open-sse/translator/helpers/claudeHelper.js");
      prepareClaudeRequest = mod.prepareClaudeRequest;

      const body = {
        messages: [{ role: "user", content: [{ type: "text", text: "search for X" }] }],
        tools: [
          { type: "web_search_20250305", max_uses: 3 },
          { name: "my_tool", description: "test", input_schema: { type: "object" } },
        ],
      };

      const result = prepareClaudeRequest(structuredClone(body), "claude");
      // web_search should still be there
      const hasWebSearch = result.tools.some(t => t.type === "web_search_20250305");
      expect(hasWebSearch).toBe(true);
    });

    it("should strip web_search for OpenAI-target provider using Claude format", async () => {
      const mod = await import("../../open-sse/translator/helpers/claudeHelper.js");
      prepareClaudeRequest = mod.prepareClaudeRequest;

      const body = {
        messages: [{ role: "user", content: [{ type: "text", text: "search for X" }] }],
        tools: [
          { type: "web_search_20250305", max_uses: 3 },
          { name: "my_tool", description: "test", input_schema: { type: "object" } },
        ],
      };

      const result = prepareClaudeRequest(structuredClone(body), "nvidia");
      // web_search should be stripped
      const hasWebSearch = result.tools.some(t => t.type === "web_search_20250305");
      expect(hasWebSearch).toBe(false);
      // function tool should remain
      expect(result.tools.some(t => t.name === "my_tool")).toBe(true);
    });

    it("should inject system message when stripping tools", async () => {
      const mod = await import("../../open-sse/translator/helpers/claudeHelper.js");
      prepareClaudeRequest = mod.prepareClaudeRequest;

      const body = {
        messages: [{ role: "user", content: [{ type: "text", text: "search for X" }] }],
        tools: [
          { type: "web_search_20250305", max_uses: 3 },
          { name: "my_tool", description: "test", input_schema: { type: "object" } },
        ],
      };

      const result = prepareClaudeRequest(structuredClone(body), "deepseek");
      // Should have system message about unavailable tools
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
      const systemText = result.system.map(s => s.text).join(" ");
      expect(systemText).toContain("not available on this provider");
      expect(systemText).toContain("web search");
    });

    it("should append to existing system message array", async () => {
      const mod = await import("../../open-sse/translator/helpers/claudeHelper.js");
      prepareClaudeRequest = mod.prepareClaudeRequest;

      const body = {
        system: [{ type: "text", text: "You are a helpful assistant." }],
        messages: [{ role: "user", content: [{ type: "text", text: "search" }] }],
        tools: [{ type: "web_search_20250305" }],
      };

      const result = prepareClaudeRequest(structuredClone(body), "groq");
      expect(result.system.length).toBeGreaterThan(1);
      expect(result.system[0].text).toBe("You are a helpful assistant.");
      expect(result.system[result.system.length - 1].text).toContain("not available");
    });

    it("should not inject system message when no tools are stripped", async () => {
      const mod = await import("../../open-sse/translator/helpers/claudeHelper.js");
      prepareClaudeRequest = mod.prepareClaudeRequest;

      const body = {
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        tools: [
          { name: "my_tool", description: "test", input_schema: { type: "object" } },
        ],
      };

      const result = prepareClaudeRequest(structuredClone(body), "openai");
      // No system message should be injected (no built-in tools to strip)
      expect(result.system).toBeUndefined();
    });

    it("should preserve web_search for Claude-compatible providers", async () => {
      const mod = await import("../../open-sse/translator/helpers/claudeHelper.js");
      prepareClaudeRequest = mod.prepareClaudeRequest;

      for (const provider of ["glm", "kimi", "minimax", "anthropic"]) {
        const body = {
          messages: [{ role: "user", content: [{ type: "text", text: "search" }] }],
          tools: [{ type: "web_search_20250305" }],
        };

        const result = prepareClaudeRequest(structuredClone(body), provider);
        const hasWebSearch = result.tools.some(t => t.type === "web_search_20250305");
        expect(hasWebSearch).toBe(true);
      }
    });
  });
});

describe("FUTURE_TRANSLATABLE provider map", () => {
  it("should document Gemini family as google_search format", () => {
    for (const provider of ["gemini", "gemini-cli", "antigravity", "vertex"]) {
      expect(FUTURE_TRANSLATABLE[provider]).toBeDefined();
      expect(FUTURE_TRANSLATABLE[provider].tool).toBe("google_search");
      expect(FUTURE_TRANSLATABLE[provider].format).toBe("gemini");
    }
  });

  it("should document xAI as web_search with xai-responses format", () => {
    expect(FUTURE_TRANSLATABLE.xai).toBeDefined();
    expect(FUTURE_TRANSLATABLE.xai.tool).toBe("web_search");
    expect(FUTURE_TRANSLATABLE.xai.format).toBe("xai-responses");
  });

  it("should document Perplexity as implicit (no tool needed)", () => {
    expect(FUTURE_TRANSLATABLE.perplexity).toBeDefined();
    expect(FUTURE_TRANSLATABLE.perplexity.tool).toBeNull();
    expect(FUTURE_TRANSLATABLE.perplexity.format).toBe("implicit");
  });

  it("should document OpenAI and Codex as web_search with openai-responses format", () => {
    for (const provider of ["openai", "codex"]) {
      expect(FUTURE_TRANSLATABLE[provider]).toBeDefined();
      expect(FUTURE_TRANSLATABLE[provider].tool).toBe("web_search");
      expect(FUTURE_TRANSLATABLE[provider].format).toBe("openai-responses");
    }
  });

  it("should not include providers without native web search", () => {
    const noSearch = ["deepseek", "groq", "mistral", "together", "fireworks",
      "cerebras", "nvidia", "github", "kiro", "cursor", "ollama"];
    for (const provider of noSearch) {
      expect(FUTURE_TRANSLATABLE[provider]).toBeUndefined();
    }
  });
});
