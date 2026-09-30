/**
 * Regression: tools WITHOUT an explicit `type:"function"` wrapper were
 * forwarded to the upstream Claude-compatible gateway with `name:"undefined"`,
 * because openai-to-claude only unwrapped `tool.function` when BOTH
 * `tool.type === "function"` AND `tool.function` were truthy.
 *
 * Repro path (v0.5.20):
 *   tools: [{ function: { name: "echo", parameters: {...} } }]   // no parent type
 *   → originalName = undefined
 *   → upstream body: { name: "undefined", description: "", input_schema: {...} }
 *
 * Pragmatic OpenAI clients and some library generators emit the bare
 * `function` wrapper shape; when this lands on a strict Anthropic-compatible
 * gateway (e.g. MiniMax's `api.minimaxi.com/anthropic/v1/messages`), the
 * payload is rejected with an "invalid tool type" / "(2013)" error, which
 * is the same family of failure that PR #2463 was diagnosing from the
 * runtimeTransport side. PR #2463 fixes the combo-path transport
 * selection; this regression closes the translator-side shape gap so
 * single-connection OpenAI clients aren't bit by it once #2463 lands.
 *
 * See: #2435, follow-up to PR #2463.
 */

import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const baseBody = (extra = {}) => ({
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

describe("openai→claude: tools shape fidelity", () => {
  it("tool WITH explicit type:'function' is rewritten to Anthropic shape", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { type: "function", function: { name: "echo", parameters: { type: "object" } } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
    // Anthropic-shape has no top-level `type` and no nested `function`.
    expect(out.tools[0]).not.toHaveProperty("type");
    expect(out.tools[0]).not.toHaveProperty("function");
  });

  it("tool WITHOUT explicit type but WITH function wrapper preserves the original name (was 'undefined' in v0.5.20)", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { function: { name: "echo", parameters: { type: "object" } } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
    // The Anthropic-shape envelope strips the OpenAI `function` wrapper entirely.
    expect(out.tools[0]).not.toHaveProperty("function");
    expect(out.tools[0]).not.toHaveProperty("type");
  });

  it("flat Anthropic-shape tool (no function wrapper) is passed through with name preserved", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { name: "echo", description: "echo input", input_schema: { type: "object" } },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].name).toBe("echo");
    expect(out.tools[0].description).toBe("echo input");
    expect(out.tools[0].input_schema).toEqual({ type: "object" });
  });

  it("non-function built-in tool types are passed through (cache_control tag is OK)", () => {
    // 9router adds a `cache_control` tag to the last tool for prompt caching;
    // the test asserts the original shape is preserved alongside it rather
    // than checking strict equality. This is the existing buildHeaders /
    // cache_control behavior unchanged by this fix.
    const out = openaiToClaudeRequest("claude-sonnet-4.5", baseBody({
      tools: [
        { type: "web_search_20250305", name: "web_search" },
      ],
    }), false);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].type).toBe("web_search_20250305");
    expect(out.tools[0].name).toBe("web_search");
  });
});
