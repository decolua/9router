/**
 * Regression: Anthropic rejects a tool that carries BOTH `defer_loading: true`
 * and `cache_control`:
 *
 *   [400] Tool 'mcp__x__y' cannot both defer_loading=true cache_control set.
 *         Tools defer_loading cannot use prompt caching.
 *
 * 9router anchors the 1h cache breakpoint on the LAST tool of the array with
 * no guard. Clients that speak MCP (Claude Code) put deferred tools at the
 * tail, so the anchor lands exactly on a tool that cannot be cached and the
 * request 400s before combo fallback can try the next hop.
 *
 * The fix anchors on the last tool that is NOT deferred, so prompt caching is
 * kept for the tools that can use it instead of being dropped wholesale.
 *
 * See: #3567.
 */

import { describe, it, expect } from "vitest";
import { anchorClaudeCache } from "../../open-sse/translator/formats/claude.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const tool = (name, extra = {}) => ({
  name,
  description: "t",
  input_schema: { type: "object", properties: {} },
  ...extra,
});

describe("defer_loading tools never carry cache_control (#3567)", () => {
  it("anchorClaudeCache: anchor moves to the last non-deferred tool", () => {
    const body = anchorClaudeCache({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("b"), tool("mcp__x__y", { defer_loading: true })],
    });

    expect(body.tools[2].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(body.tools[0].cache_control).toBeUndefined();
  });

  it("anchorClaudeCache: no tool is cached when every tool is deferred", () => {
    const body = anchorClaudeCache({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("mcp__a", { defer_loading: true }), tool("mcp__b", { defer_loading: true })],
    });

    expect(body.tools.every(t => t.cache_control === undefined)).toBe(true);
  });

  it("anchorClaudeCache: strips a cache_control the client put on a deferred tool", () => {
    const body = anchorClaudeCache({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("mcp__a", { defer_loading: true, cache_control: { type: "ephemeral" } })],
    });

    expect(body.tools[0].cache_control).toBeUndefined();
  });

  it("anchorClaudeCache: unchanged behaviour when no tool is deferred", () => {
    const body = anchorClaudeCache({
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("b")],
    });

    expect(body.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(body.tools[0].cache_control).toBeUndefined();
  });

  it("prepareClaudeRequest: deferred tail tool does not get the anchor", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("mcp__x__y", { defer_loading: true })],
    }, "claude");

    expect(out.tools).toHaveLength(2);
    expect(out.tools[1].cache_control).toBeUndefined();
    expect(out.tools[1].defer_loading).toBe(true);
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});
