import { describe, expect, it } from "vitest";
import { budgetToolsToContext } from "../../open-sse/utils/toolBudget.js";

function tool(name, description = name) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties: { query: { type: "string" } } } } };
}

describe("tool context budget", () => {
  it("culls ranked tools when message + schema tokens exceed the model budget", () => {
    const tools = Array.from({ length: 30 }, (_, i) => tool("mcp__server__tool_" + i, "filesystem search tool " + i));
    const body = { messages: [{ role: "user", content: "find the filesystem search tool" }] };
    const result = budgetToolsToContext(tools, body, "test-session", { contextWindow: 2000, maxOutput: 256 });
    expect(result.stats.changed).toBe(true);
    expect(result.tools.length).toBeLessThan(tools.length);
    expect(result.stats.totalTokensAfter).toBeLessThanOrEqual(result.stats.inputBudgetTokens);
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
