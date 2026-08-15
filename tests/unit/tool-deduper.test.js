import { describe, it, expect } from "vitest";
import { dedupeTools } from "open-sse/utils/toolDeduper.js";

function tool(name, description = "d") {
  return { name, description, input_schema: { type: "object", properties: {} } };
}

describe("dedupeTools exact-name rule", () => {
  it("drops second tool with the same name, keeps first", () => {
    const { tools, stripped } = dedupeTools([tool("Bash", "run"), tool("Bash", "dupe"), tool("Read")]);
    expect(tools.map((t) => t.name)).toEqual(["Bash", "Read"]);
    expect(tools[0].description).toBe("run");
    expect(stripped).toEqual(["Bash"]);
  });

  it("keeps unique names untouched", () => {
    const list = [tool("Bash"), tool("Read"), tool("Edit")];
    const { tools, stripped } = dedupeTools(list);
    expect(tools).toEqual(list);
    expect(stripped).toEqual([]);
  });

  it("handles empty input", () => {
    expect(dedupeTools([])).toEqual({ tools: [], stripped: [] });
    expect(dedupeTools(null)).toEqual({ tools: null, stripped: [] });
  });

  it("combines soft rules with exact-name strip", () => {
    const list = [tool("mcp__exa__web_search_exa"), tool("WebSearch"), tool("Bash"), tool("Bash")];
    const { tools, stripped } = dedupeTools(list);
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped).toContain("WebSearch");
    expect(stripped).toContain("Bash");
  });
});