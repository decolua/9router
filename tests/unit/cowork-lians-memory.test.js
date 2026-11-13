import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { LOCAL_STDIO_PLUGINS } = require("../../src/shared/constants/coworkPlugins.js");

const lians = LOCAL_STDIO_PLUGINS.find((plugin) => plugin.name === "lians-memory");

describe("Lians Cowork memory plugin", () => {
  it("launches the published local MCP server through uvx", () => {
    expect(lians).toBeDefined();
    expect(lians.command).toBe("uvx");
    expect(lians.args).toEqual(["--from", "lians-sdk[mcp]", "lians-mcp"]);
    expect(lians.setupUrl).toBe("https://docs.astral.sh/uv/getting-started/installation/");
  });

  it("declares the published Lians 0.5.0 MCP tool surface", () => {
    expect(lians.toolNames).toEqual([
      "remember",
      "recall",
      "recall_at",
      "reconstruct",
      "list_conflicts",
      "memory_lineage",
      "fact_history",
      "backtest_check",
      "memory_feedback",
    ]);
  });

  it("does not duplicate a local plugin name or tool name", () => {
    expect(LOCAL_STDIO_PLUGINS.filter((plugin) => plugin.name === lians.name)).toHaveLength(1);
    expect(new Set(lians.toolNames).size).toBe(lians.toolNames.length);
  });
});
