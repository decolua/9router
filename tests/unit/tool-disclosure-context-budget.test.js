import { describe, expect, it } from "vitest";
import { budgetToolsToContext, estimateTokens } from "../../open-sse/utils/toolBudget.js";
import { _recentStats } from "../../open-sse/utils/toolDisclosure.js";

function tool(name, description = name) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties: { query: { type: "string" } } } } };
}

const searchTools = () => Array.from({ length: 30 }, (_, i) => tool("mcp__server__tool_" + i, "filesystem search tool " + i));
const searchBody = { messages: [{ role: "user", content: "find the filesystem search tool" }] };

// Budget = floor(contextWindow * 0.85) - min(maxOutput, 32768). The 30 tools above are
// ~1.2k estimated tokens, so a 1500-token window (budget 1019) forces a cull.
const TIGHT = { contextWindow: 1500, maxOutput: 256 };

describe("tool context budget", () => {
  it("culls ranked tools when message + schema tokens exceed the model budget", () => {
    const tools = searchTools();
    const result = budgetToolsToContext(tools, searchBody, "test-session", TIGHT);
    expect(result.stats.totalTokensBefore).toBeGreaterThan(result.stats.inputBudgetTokens);
    expect(result.stats.changed).toBe(true);
    expect(result.tools.length).toBeLessThan(tools.length);
    expect(result.stats.totalTokensAfter).toBeLessThanOrEqual(result.stats.inputBudgetTokens);
  });

  it("keeps as many tools as fit, not the fewest", () => {
    const tools = searchTools();
    const { tools: kept, stats } = budgetToolsToContext(tools, searchBody, "test-session-max", TIGHT);
    const nextTool = tools.find((t) => !kept.includes(t));
    // One more tool would overflow: the cull is minimal.
    expect(stats.messageTokens + estimateTokens([...kept, nextTool])).toBeGreaterThan(stats.inputBudgetTokens);
    expect(kept.length).toBeGreaterThan(1);
  });

  it("does not add budget probes to the disclosure stats ring buffer", () => {
    _recentStats.length = 0;
    budgetToolsToContext(searchTools(), searchBody, "test-session-stats", TIGHT);
    expect(_recentStats).toHaveLength(0);
  });

  it("leaves tools untouched when even the smallest selection cannot fit", () => {
    const tools = searchTools();
    // ~1008 message tokens: under the 1019 budget, but no room for a single ~38-token tool.
    const body = { messages: [{ role: "user", content: "x".repeat(4000) }] };
    const result = budgetToolsToContext(tools, body, "test-session-nofit", TIGHT);
    expect(result.stats.messagesOverBudget).toBe(false);
    expect(result.tools).toBe(tools);
    expect(result.stats.changed).toBe(false);
  });

  it("keeps the leading tools when the query matches none of them", () => {
    const tools = searchTools();
    const body = { messages: [{ role: "user", content: "zzz ".repeat(200) }] };
    const { tools: kept, stats } = budgetToolsToContext(tools, body, "test-session-nomatch", TIGHT);
    expect(stats.changed).toBe(true);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toEqual(tools.slice(0, kept.length));
  });

  it("does not touch a request that already fits", () => {
    const tools = [tool("read_file", "read a file")];
    const body = { messages: [{ role: "user", content: "read package.json" }] };
    const result = budgetToolsToContext(tools, body, "test-session", { contextWindow: 200000, maxOutput: 1024 });
    expect(result.stats.changed).toBe(false);
    expect(result.tools).toBe(tools);
  });

  it("reports message-only overflow instead of deleting conversation history", () => {
    const tools = [tool("read_file", "read a file")];
    const body = { messages: [{ role: "user", content: "x".repeat(10000) }] };
    const result = budgetToolsToContext(tools, body, "test-session", { contextWindow: 1000, maxOutput: 128 });
    expect(result.stats.messagesOverBudget).toBe(true);
    expect(result.tools).toBe(tools);
  });
});