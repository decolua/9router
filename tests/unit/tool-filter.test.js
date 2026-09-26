import { describe, it, expect } from "vitest";
import { toolFilter } from "open-sse/utils/toolFilter.js";

function mkTool(name, description = "") {
  return { name, description };
}

function names(tools) {
  return tools.map((t) => t.name);
}

const TOOLS = [
  mkTool("mcp__filesystem__read_file", "Read a file from the filesystem"),
  mkTool("mcp__filesystem__write_file", "Write content to a file"),
  mkTool("mcp__exa__web_search_exa", "Search the web using Exa"),
  mkTool("mcp__github__create_pull_request", "Create a GitHub pull request"),
  mkTool("mcp__github__list_issues", "List GitHub issues"),
  mkTool("Bash", "Run a bash command"),
  mkTool("Read", "Read a file"),
  mkTool("ToolSearch", "Search available tools"),
  mkTool("mcp__internal__debug_tool", "Internal debug only"),
];

describe("toolFilter", () => {
  it("returns tools unchanged when config is null", () => {
    expect(names(toolFilter(TOOLS, null))).toEqual(names(TOOLS));
  });

  it("returns tools unchanged when config has no rules", () => {
    expect(names(toolFilter(TOOLS, {}))).toEqual(names(TOOLS));
  });

  it("excludes tools by exact name", () => {
    const result = toolFilter(TOOLS, { excludeTools: ["Bash", "Read"] });
    expect(names(result)).not.toContain("Bash");
    expect(names(result)).not.toContain("Read");
    expect(names(result)).toContain("ToolSearch");
  });

  it("excludes tools by MCP server (bare name)", () => {
    const result = toolFilter(TOOLS, { excludeServers: ["filesystem"] });
    expect(names(result)).not.toContain("mcp__filesystem__read_file");
    expect(names(result)).not.toContain("mcp__filesystem__write_file");
    expect(names(result)).toContain("mcp__exa__web_search_exa");
  });

  it("excludes tools by MCP server (glob prefix)", () => {
    const result = toolFilter(TOOLS, { excludeServers: ["mcp__github__*"] });
    expect(names(result)).not.toContain("mcp__github__create_pull_request");
    expect(names(result)).not.toContain("mcp__github__list_issues");
    expect(names(result)).toContain("mcp__exa__web_search_exa");
  });

  it("keeps alwaysInclude tools even when excluded by server rule", () => {
    const result = toolFilter(TOOLS, {
      excludeServers: ["filesystem"],
      alwaysInclude: ["mcp__filesystem__read_file"],
    });
    expect(names(result)).toContain("mcp__filesystem__read_file");
    expect(names(result)).not.toContain("mcp__filesystem__write_file");
  });

  it("filters to includeOnlyServers when specified", () => {
    const result = toolFilter(TOOLS, { includeOnlyServers: ["github"] });
    const n = names(result);
    expect(n).toContain("mcp__github__create_pull_request");
    expect(n).toContain("mcp__github__list_issues");
    expect(n).not.toContain("mcp__exa__web_search_exa");
    expect(n).not.toContain("Bash");
  });

  it("includeOnlyServers ORs with includeOnlyTools", () => {
    const result = toolFilter(TOOLS, {
      includeOnlyServers: ["github"],
      includeOnlyTools: ["Bash"],
    });
    const n = names(result);
    expect(n).toContain("mcp__github__create_pull_request");
    expect(n).toContain("Bash");
    expect(n).not.toContain("ToolSearch");
  });

  it("excludes by description pattern", () => {
    const result = toolFilter(TOOLS, { excludeDescriptionPattern: "internal" });
    expect(names(result)).not.toContain("mcp__internal__debug_tool");
    expect(names(result)).toContain("mcp__exa__web_search_exa");
  });

  it("includeOnlyDescriptionPattern keeps only matching", () => {
    const result = toolFilter(TOOLS, { includeOnlyDescriptionPattern: "GitHub" });
    const n = names(result);
    expect(n).toContain("mcp__github__create_pull_request");
    expect(n).toContain("mcp__github__list_issues");
    expect(n).not.toContain("Bash");
  });

  it("returns empty array when all excluded", () => {
    const result = toolFilter(TOOLS, {
      excludeServers: ["filesystem", "exa", "github", "internal"],
      excludeTools: ["Bash", "Read", "ToolSearch"],
    });
    expect(result).toHaveLength(0);
  });

  it("handles empty tools array", () => {
    expect(toolFilter([], { excludeServers: ["filesystem"] })).toEqual([]);
  });

  it("handles OpenAI function-wrapping shape", () => {
    const oaiTools = [
      { type: "function", function: { name: "mcp__filesystem__read_file", description: "Read" } },
      { type: "function", function: { name: "Bash", description: "Run bash" } },
    ];
    const result = toolFilter(oaiTools, { excludeServers: ["filesystem"] });
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("Bash");
  });
});
