import { describe, it, expect } from "vitest";
import { dedupeTools, rankTools } from "../../open-sse/utils/toolDeduper.js";

const BASH = (name = "Bash", desc = "Run a shell command") => ({
  name,
  description: desc,
  input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
});

const FUNC_SHAPE = (name = "Bash") => ({
  type: "function",
  function: { name, description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } } } },
});

const MCP_EXA = { name: "mcp__exa__web_search_exa", description: "search" };

describe("toolDeduper — MCP-equivalent built-in rules (existing behavior)", () => {
  it("claude client + Exa MCP → drops built-in WebSearch/WebFetch", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }, { name: "WebFetch", description: "web" }, BASH()],
      { clientTool: "claude" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped.sort()).toEqual(["WebFetch", "WebSearch"]);
  });

  it("non-claude client → MCP built-in rules do NOT run (behavior preserved)", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }],
      { clientTool: "codex" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "WebSearch"]);
    expect(stripped).toEqual([]);
  });

  it("legacy call without opts still applies MCP rules for claude callers (back-compat shape)", () => {
    // chatCore always passes opts now, but old direct callers keep prior behavior:
    // without clientTool, MCP rules stay dormant (they were claude-gated anyway).
    const { tools, stripped } = dedupeTools([MCP_EXA, { name: "WebSearch", description: "web" }]);
    expect(tools).toHaveLength(2);
    expect(stripped).toEqual([]);
  });
});

describe("toolDeduper — DeepSeek same-name dedup (new)", () => {
  it("deepseek model + duplicate tool names → keeps first definition", () => {
    const first = BASH();
    const dup = BASH("Bash", "duplicate description");
    const { tools, stripped } = dedupeTools([first, dup], { model: "deepseek-v4-flash" });
    expect(tools).toEqual([first]); // first wins, including its description
    expect(stripped).toEqual(["Bash"]);
  });

  it("deepseek model + (max) thinking suffix → still dedups (suffix stripped before match)", () => {
    const { tools, stripped } = dedupeTools([BASH(), BASH("Bash", "dup")], { model: "deepseek-v4-flash(max)" });
    expect(tools).toHaveLength(1);
    expect(stripped).toEqual(["Bash"]);
  });

  it("deepseek + 3 same-name tools → keeps first, drops both duplicates", () => {
    const { tools, stripped } = dedupeTools([BASH(), BASH("Bash", "d1"), BASH("Bash", "d2")], { model: "deepseek-v4-pro" });
    expect(tools).toHaveLength(1);
    expect(stripped).toEqual(["Bash", "Bash"]);
  });

  it("deepseek + OpenAI function-shape tools → dedups by function.name", () => {
    const { tools } = dedupeTools([FUNC_SHAPE("Bash"), FUNC_SHAPE("Bash")], { model: "deepseek-v4-flash" });
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("Bash");
  });

  it("non-DeepSeek model + duplicate tool names → untouched (GLM/MiniMax/Kimi accept them)", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, { model: "glm-5.2" });
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("no model declared → same-name dedup does NOT run (safe default)", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, {});
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("deepseek + distinct names → nothing stripped", () => {
    const { tools, stripped } = dedupeTools([BASH("Bash"), BASH("ReadFile")], { model: "deepseek-v4-flash" });
    expect(tools).toHaveLength(2);
    expect(stripped).toEqual([]);
  });

  it("claude client + deepseek + MCP trigger → both rules apply (union stripped)", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }, BASH(), BASH("Bash", "dup")],
      { clientTool: "claude", model: "deepseek-v4-flash" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped.sort()).toEqual(["Bash", "WebSearch"]);
  });
});

const REL = (i) => ({ name: `RunTask${i}`, description: "run project build commands via shell server deploy" });
const IRREL = (i) => ({ name: `ZoneTask${i}`, description: "quantum zigzag widget frobnicate" });
const RANK_MSGS = [
  { role: "user", content: [{ type: "text", text: "please use the shell to run project build commands on the server" }] },
];
const REL_N = (n) => Array.from({ length: n }, (_, i) => REL(i));
const IRREL_N = (n) => Array.from({ length: n }, (_, i) => IRREL(i));

describe("toolDeduper — rankTools (lexical relevance)", () => {
  it("drops a zero-overlap tool when the ranking path is exercised", () => {
    const tools = [...REL_N(16), IRREL(0), IRREL(1)];
    const { tools: out, stripped } = rankTools(tools, { messages: RANK_MSGS });
    expect(out).toHaveLength(16);
    expect(stripped.sort()).toEqual(["ZoneTask0", "ZoneTask1"]);
    expect(out.map((t) => t.name)).toEqual(REL_N(16).map((t) => t.name)); // input order preserved, relevant kept
  });

  it("force-keeps a tool whose name appears in the query even at score 0", () => {
    const tools = [...REL_N(16), { name: "b_c", description: "gamma frobnicate" }, IRREL(0), IRREL(1), IRREL(2)];
    const messages = [{ role: "user", content: "load the b_c config for the shell run build project" }];
    const { tools: out, stripped } = rankTools(tools, { messages });
    expect(out.some((t) => t.name === "b_c")).toBe(true); // named tool survives
    expect(stripped).not.toContain("b_c");
    expect(stripped.sort()).toEqual(["ZoneTask0", "ZoneTask1", "ZoneTask2"]);
  });

  it("never drops below the keep-floor ceil(n*0.5)", () => {
    const tools = IRREL_N(20); // every tool is a candidate
    const { tools: out, stripped } = rankTools(tools, { messages: [{ role: "user", content: "zebra mango pineapple upside down cake" }] });
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil(20 * 0.5));
    expect(out.length).toBe(12);
    expect(stripped).toHaveLength(8);
  });

  it("never drops more than the drop-cap floor(n*0.4)", () => {
    const tools = IRREL_N(30);
    const { tools: out, stripped } = rankTools(tools, { messages: [{ role: "user", content: "zebra mango pineapple upside down cake" }] });
    expect(stripped.length).toBeLessThanOrEqual(Math.floor(30 * 0.4));
    expect(stripped).toHaveLength(12);
    expect(out.length).toBe(18);
  });

  it("below RANK_MIN_TOOLS → returns tools unchanged", () => {
    const tools = IRREL_N(15);
    const { tools: out, stripped } = rankTools(tools, { messages: [{ role: "user", content: "zebra mango" }] });
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("empty/degenerate query → returns tools unchanged", () => {
    const tools = IRREL_N(20);
    for (const messages of [undefined, [], [{ role: "user" }], [{ role: "user", content: "" }], [{ role: "user", content: [] }]]) {
      const { tools: out, stripped } = rankTools(tools, { messages });
      expect(out).toBe(tools);
      expect(stripped).toEqual([]);
    }
  });

  it("malformed tool entries don't throw (fail-open)", () => {
    const tools = [null, undefined, 42, "str", { name: null }, { function: null }, ...IRREL_N(11)];
    expect(() => rankTools(tools, { messages: RANK_MSGS })).not.toThrow();

    const boom = { name: { toString() { throw new Error("boom"); } }, description: "x" };
    const poisoned = [...IRREL_N(16), boom];
    const { tools: out, stripped } = rankTools(poisoned, { messages: RANK_MSGS });
    expect(out).toBe(poisoned); // throw inside scoring → original returned
    expect(stripped).toEqual([]);
  });
});
