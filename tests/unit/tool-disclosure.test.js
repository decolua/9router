import { describe, it, expect, beforeEach } from "vitest";
import {
  disclosureTools,
  buildIndex,
  bm25Scores,
  tokenize,
  extractPinnedNames,
  extractLastUserMessage,
  _cache,
} from "open-sse/utils/toolDisclosure.js";

function mkTool(name, description = "", params = []) {
  const properties = Object.fromEntries(params.map((p) => [p, { type: "string" }]));
  return {
    name,
    description,
    input_schema: { type: "object", properties },
  };
}

const TOOLS = [
  mkTool("mcp__filesystem__read_file", "Read a file from the local filesystem", ["path"]),
  mkTool("mcp__filesystem__write_file", "Write content to a file on disk", ["path", "content"]),
  mkTool("mcp__github__create_pull_request", "Create a pull request on GitHub", ["title", "body", "branch"]),
  mkTool("mcp__github__list_issues", "List open issues in a GitHub repository", ["repo"]),
  mkTool("mcp__exa__web_search_exa", "Search the web for information using Exa neural search", ["query"]),
  mkTool("mcp__gmail__list_threads", "List email threads from inbox", ["maxResults"]),
  mkTool("mcp__gmail__send_message", "Send an email message via Gmail", ["to", "subject", "body"]),
  mkTool("mcp__linear__create_issue", "Create a new issue in Linear project management", ["title", "description"]),
  mkTool("mcp__linear__list_issues", "List issues from a Linear team or project", ["teamId"]),
  mkTool("mcp__slack__send_message", "Send a message to a Slack channel", ["channel", "text"]),
  mkTool("Bash", "Execute shell commands", ["command"]),
  mkTool("Read", "Read file contents", ["path"]),
  mkTool("Edit", "Edit file contents", ["path", "oldString", "newString"]),
  mkTool("ToolSearch", "Search available tool schemas by relevance", ["query"]),
  mkTool("mcp__stripe__list_customers", "List Stripe customers", ["limit"]),
  mkTool("mcp__stripe__create_charge", "Create a Stripe charge", ["amount", "currency"]),
  mkTool("mcp__database__query", "Run a SQL query against the database", ["sql"]),
  mkTool("mcp__database__insert", "Insert records into a database table", ["table", "data"]),
  mkTool("mcp__jira__create_ticket", "Create a Jira ticket", ["summary", "description"]),
  mkTool("mcp__jira__list_tickets", "List Jira tickets in a project", ["project"]),
  mkTool("mcp__figma__export_component", "Export a Figma component", ["nodeId"]),
];

function body(userMessage, prior = []) {
  return {
    messages: [...prior, { role: "user", content: userMessage }],
  };
}

beforeEach(() => {
  _cache.clear();
});

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric", () => {
    expect(tokenize("Read a File")).toEqual(["read", "file"]);
  });

  it("removes stop words", () => {
    expect(tokenize("do not use the file")).toEqual(["file"]);
  });

  it("preserves underscore-joined tokens", () => {
    const t = tokenize("read_file write_file");
    expect(t).toContain("read_file");
  });

  it("handles empty / null", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe("extractLastUserMessage", () => {
  it("returns last user message string", () => {
    const b = { messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }, { role: "user", content: "what files?" }] };
    expect(extractLastUserMessage(b)).toBe("what files?");
  });

  it("handles array content blocks", () => {
    const b = { messages: [{ role: "user", content: [{ type: "text", text: "search for issues" }] }] };
    expect(extractLastUserMessage(b)).toBe("search for issues");
  });

  it("returns empty string when no user messages", () => {
    expect(extractLastUserMessage({ messages: [] })).toBe("");
    expect(extractLastUserMessage({})).toBe("");
  });
});

describe("extractPinnedNames", () => {
  it("always includes ToolSearch", () => {
    const pinned = extractPinnedNames({});
    expect(pinned.has("ToolSearch")).toBe(true);
  });

  it("includes OpenAI format tool_calls from history", () => {
    const b = { messages: [{ role: "assistant", tool_calls: [{ function: { name: "Bash" } }] }] };
    expect(extractPinnedNames(b).has("Bash")).toBe(true);
  });

  it("includes Claude format tool_use blocks from history", () => {
    const b = { messages: [{ role: "assistant", content: [{ type: "tool_use", name: "Read" }] }] };
    expect(extractPinnedNames(b).has("Read")).toBe(true);
  });

  it("includes forced tool_choice", () => {
    const b = { tool_choice: { name: "Edit" }, messages: [] };
    expect(extractPinnedNames(b).has("Edit")).toBe(true);
  });

  it("includes alwaysInclude config list", () => {
    expect(extractPinnedNames({}, ["Bash"]).has("Bash")).toBe(true);
  });
});

describe("BM25 index + scoring", () => {
  it("scores filesystem tools higher for a file-reading query", () => {
    const index = buildIndex(TOOLS);
    const scores = bm25Scores(index, tokenize("read a file from disk"));
    const readIdx = TOOLS.findIndex((t) => t.name === "mcp__filesystem__read_file");
    const emailIdx = TOOLS.findIndex((t) => t.name === "mcp__gmail__send_message");
    expect(scores[readIdx]).toBeGreaterThan(scores[emailIdx]);
  });

  it("scores GitHub tools higher for a pull request query", () => {
    const index = buildIndex(TOOLS);
    const scores = bm25Scores(index, tokenize("open a pull request"));
    const prIdx = TOOLS.findIndex((t) => t.name === "mcp__github__create_pull_request");
    const dbIdx = TOOLS.findIndex((t) => t.name === "mcp__database__query");
    expect(scores[prIdx]).toBeGreaterThan(scores[dbIdx]);
  });

  it("scores all zero for an empty query", () => {
    const index = buildIndex(TOOLS);
    const scores = bm25Scores(index, []);
    expect(scores.every((s) => s === 0)).toBe(true);
  });
});

describe("disclosureTools", () => {
  it("returns tools unchanged when count <= maxTools", () => {
    const small = TOOLS.slice(0, 5);
    const { stats } = disclosureTools(small, body("hello"), "conn1", { maxTools: 20 });
    expect(stats).toBeNull();
  });

  it("reduces tool count to maxTools", () => {
    const { tools: result, stats } = disclosureTools(TOOLS, body("read a file"), "conn2", { maxTools: 10 });
    expect(result.length).toBeLessThanOrEqual(10);
    expect(stats).not.toBeNull();
    expect(stats.before).toBe(TOOLS.length);
  });

  it("always keeps ToolSearch regardless of query", () => {
    const { tools: result } = disclosureTools(TOOLS, body("read a file"), "conn3", { maxTools: 5 });
    expect(result.map((t) => t.name)).toContain("ToolSearch");
  });

  it("keeps tools used in prior conversation", () => {
    const prior = [{ role: "assistant", content: [{ type: "tool_use", name: "mcp__stripe__list_customers" }] }];
    const { tools: result } = disclosureTools(TOOLS, body("what files exist?", prior), "conn4", { maxTools: 5 });
    expect(result.map((t) => t.name)).toContain("mcp__stripe__list_customers");
  });

  it("ranks filesystem tools near top for a file query", () => {
    const { tools: result } = disclosureTools(TOOLS, body("read a file from the filesystem"), "conn5", { maxTools: 8 });
    const resultNames = result.map((t) => t.name);
    expect(resultNames).toContain("mcp__filesystem__read_file");
  });

  it("ranks gmail tools near top for an email query", () => {
    const { tools: result } = disclosureTools(TOOLS, body("list my email inbox threads"), "conn6", { maxTools: 8 });
    const resultNames = result.map((t) => t.name);
    expect(resultNames).toContain("mcp__gmail__list_threads");
  });

  it("reuses cached index on second call with same tool set", () => {
    disclosureTools(TOOLS, body("file query"), "conn7", { maxTools: 10 });
    const before = _cache.get("conn7").index;
    disclosureTools(TOOLS, body("another query"), "conn7", { maxTools: 10 });
    expect(_cache.get("conn7").index).toBe(before); // same object reference
  });

  it("rebuilds index when tool set changes", () => {
    disclosureTools(TOOLS, body("file query"), "conn8", { maxTools: 10 });
    const before = _cache.get("conn8").index;
    const fewerTools = TOOLS.slice(0, 15);
    disclosureTools(fewerTools, body("another query"), "conn8", { maxTools: 10 });
    expect(_cache.get("conn8").index).not.toBe(before);
  });

  it("works without connectionId (no caching path)", () => {
    const { tools: result, stats } = disclosureTools(TOOLS, body("read file"), null, { maxTools: 8 });
    expect(result.length).toBeLessThanOrEqual(8);
    expect(stats).not.toBeNull();
  });

  it("handles empty tools array", () => {
    const { tools, stats } = disclosureTools([], body("hello"), "conn9", { maxTools: 10 });
    expect(tools).toEqual([]);
    expect(stats).toBeNull();
  });

  it("respects alwaysInclude config", () => {
    const { tools: result } = disclosureTools(
      TOOLS,
      body("list Jira tickets"),
      "conn10",
      { maxTools: 5, alwaysInclude: ["mcp__stripe__create_charge"] }
    );
    expect(result.map((t) => t.name)).toContain("mcp__stripe__create_charge");
  });
});
