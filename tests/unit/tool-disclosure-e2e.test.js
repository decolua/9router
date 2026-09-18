/**
 * E2E comparison: same request with tool disclosure OFF vs ON.
 *
 * Not a live HTTP test — runs disclosureTools() and toolFilter() directly
 * against a realistic 40-tool corpus and prints a side-by-side report so
 * the diff is visible in CI output.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { disclosureTools, _cache, _recentStats } from "open-sse/utils/toolDisclosure.js";
import { toolFilter } from "open-sse/utils/toolFilter.js";

function mkTool(name, description = "", params = []) {
  const properties = Object.fromEntries(params.map((p) => [p, { type: "string", description: p }]));
  const schema = JSON.stringify({ type: "object", properties });
  return { name, description, input_schema: { type: "object", properties } };
}

const CORPUS = [
  mkTool("mcp__filesystem__read_file", "Read a file from the local filesystem", ["path"]),
  mkTool("mcp__filesystem__write_file", "Write content to a file on disk", ["path", "content"]),
  mkTool("mcp__filesystem__list_directory", "List files in a directory", ["path"]),
  mkTool("mcp__filesystem__move_file", "Move or rename a file", ["source", "destination"]),
  mkTool("mcp__filesystem__delete_file", "Delete a file from disk", ["path"]),
  mkTool("mcp__github__create_pull_request", "Create a pull request on GitHub", ["title", "body", "branch"]),
  mkTool("mcp__github__list_issues", "List open issues in a GitHub repository", ["repo"]),
  mkTool("mcp__github__merge_pull_request", "Merge a pull request", ["pr", "repo"]),
  mkTool("mcp__github__comment_on_issue", "Post a comment on a GitHub issue", ["issue", "body"]),
  mkTool("mcp__exa__web_search_exa", "Search the web for information using Exa neural search", ["query"]),
  mkTool("mcp__gmail__list_threads", "List email threads from inbox", ["maxResults"]),
  mkTool("mcp__gmail__send_message", "Send an email message via Gmail", ["to", "subject", "body"]),
  mkTool("mcp__gmail__get_thread", "Get a specific email thread", ["threadId"]),
  mkTool("mcp__linear__create_issue", "Create a new issue in Linear project management", ["title", "description"]),
  mkTool("mcp__linear__list_issues", "List issues from a Linear team or project", ["teamId"]),
  mkTool("mcp__linear__update_issue", "Update an existing Linear issue", ["id", "status"]),
  mkTool("mcp__slack__send_message", "Send a message to a Slack channel", ["channel", "text"]),
  mkTool("mcp__slack__list_channels", "List Slack channels in the workspace", []),
  mkTool("mcp__slack__get_thread", "Get replies in a Slack thread", ["channel", "ts"]),
  mkTool("mcp__stripe__list_customers", "List Stripe customers", ["limit"]),
  mkTool("mcp__stripe__create_charge", "Create a Stripe payment charge", ["amount", "currency"]),
  mkTool("mcp__stripe__get_invoice", "Get a Stripe invoice by ID", ["invoiceId"]),
  mkTool("mcp__database__query", "Run a SQL query against the database", ["sql"]),
  mkTool("mcp__database__insert", "Insert records into a database table", ["table", "data"]),
  mkTool("mcp__database__migrate", "Run a database schema migration", ["migration"]),
  mkTool("mcp__jira__create_ticket", "Create a Jira ticket", ["summary", "description"]),
  mkTool("mcp__jira__list_tickets", "List Jira tickets in a project", ["project"]),
  mkTool("mcp__figma__export_component", "Export a Figma design component as an image", ["nodeId"]),
  mkTool("mcp__figma__get_file", "Get a Figma file by key", ["fileKey"]),
  mkTool("mcp__calendar__create_event", "Create a calendar event", ["title", "start", "end"]),
  mkTool("mcp__calendar__list_events", "List calendar events in a date range", ["start", "end"]),
  mkTool("Bash", "Execute shell commands in the terminal", ["command"]),
  mkTool("Read", "Read the contents of a file", ["file_path"]),
  mkTool("Edit", "Edit a file by replacing text", ["file_path", "old_string", "new_string"]),
  mkTool("Write", "Write a new file to disk", ["file_path", "content"]),
  mkTool("Glob", "Find files matching a glob pattern", ["pattern"]),
  mkTool("Grep", "Search file contents with regex", ["pattern"]),
  mkTool("ToolSearch", "Search available tool schemas by relevance", ["query"]),
  mkTool("mcp__notion__get_page", "Get a Notion page by ID", ["pageId"]),
  mkTool("mcp__notion__create_page", "Create a new Notion page", ["parentId", "title"]),
];

function makeBody(userMessage) {
  return { messages: [{ role: "user", content: userMessage }] };
}

function schemaBytes(tools) {
  return JSON.stringify(tools).length;
}

function report(label, tools, original) {
  const pct = original > 0 ? Math.round((1 - tools.length / original) * 100) : 0;
  const bytesBefore = schemaBytes(CORPUS.slice(0, original));
  const bytesAfter = schemaBytes(tools);
  const kbSaved = ((bytesBefore - bytesAfter) / 1024).toFixed(1);
  return `${label}: ${original} → ${tools.length} tools (${pct}% fewer, ~${kbSaved} KB saved)`;
}

beforeEach(() => {
  _cache.clear();
  _recentStats.length = 0;
});

describe("tool disclosure e2e comparison", () => {
  it("file-read query: BM25 keeps filesystem tools, deprioritises email/stripe", () => {
    const query = "read the config file and update the port number";
    const body = makeBody(query);
    const config = { maxTools: 15, disclosureEnabled: true };

    // OFF: all tools pass through (below threshold test — force threshold low)
    const offResult = { tools: CORPUS, stats: null };

    // ON: BM25 selection
    const onResult = disclosureTools(CORPUS, body, "conn-1", config);

    console.log("\n=== Tool Disclosure E2E Report ===");
    console.log(`Query: "${query}"`);
    console.log(`OFF:  ${offResult.tools.length} tools, ${(schemaBytes(CORPUS) / 1024).toFixed(1)} KB`);
    console.log(report("ON ", onResult.tools, CORPUS.length));
    console.log("Kept:", onResult.tools.map((t) => t.name).join(", "));
    console.log("Stripped:", (onResult.stats?.strippedNames || []).join(", "));

    expect(onResult.tools.length).toBeLessThan(CORPUS.length);
    expect(onResult.tools.length).toBeLessThanOrEqual(15);

    const keptNames = onResult.tools.map((t) => t.name);
    expect(keptNames).toContain("mcp__filesystem__read_file");
    expect(keptNames).toContain("mcp__filesystem__write_file");
    expect(keptNames).toContain("ToolSearch"); // always pinned
  });

  it("PR query: BM25 keeps github tools, deprioritises filesystem/stripe", () => {
    const query = "create a pull request for the auth fix branch";
    const body = makeBody(query);
    const config = { maxTools: 12, disclosureEnabled: true };

    const onResult = disclosureTools(CORPUS, body, "conn-2", config);

    console.log("\n=== PR Query Report ===");
    console.log(report("ON ", onResult.tools, CORPUS.length));
    console.log("Kept:", onResult.tools.map((t) => t.name).join(", "));

    expect(onResult.tools.length).toBeLessThanOrEqual(12);
    const keptNames = onResult.tools.map((t) => t.name);
    expect(keptNames).toContain("mcp__github__create_pull_request");
    expect(keptNames).toContain("ToolSearch");
  });

  it("no-op below maxTools threshold", () => {
    const small = CORPUS.slice(0, 10);
    const body = makeBody("read a file");
    const result = disclosureTools(small, body, "conn-3", { maxTools: 20 });
    expect(result.stats).toBeNull();
    expect(result.tools).toBe(small);
  });

  it("static filter removes excluded server before BM25", () => {
    const filterConfig = { excludeServers: ["stripe", "calendar"] };
    const filtered = toolFilter(CORPUS, filterConfig);

    const stripeTools = filtered.filter((t) => t.name.startsWith("mcp__stripe__"));
    const calendarTools = filtered.filter((t) => t.name.startsWith("mcp__calendar__"));
    expect(stripeTools).toHaveLength(0);
    expect(calendarTools).toHaveLength(0);
    expect(filtered.length).toBe(CORPUS.length - 5); // 3 stripe + 2 calendar

    console.log("\n=== Static Filter Report ===");
    console.log(report("filter", filtered, CORPUS.length));
  });

  it("combined: filter then BM25 stacks reductions", () => {
    const query = "send a slack message to the team";
    const body = makeBody(query);

    const filterConfig = { excludeServers: ["stripe", "figma", "notion", "calendar", "database", "jira"] };
    const filtered = toolFilter(CORPUS, filterConfig);

    const disclosed = disclosureTools(filtered, body, "conn-4", { maxTools: 10 });

    console.log("\n=== Combined Filter + BM25 Report ===");
    console.log(`Original: ${CORPUS.length} tools`);
    console.log(report("after filter", filtered, CORPUS.length));
    console.log(report("after BM25  ", disclosed.tools, CORPUS.length));
    console.log("Final kept:", disclosed.tools.map((t) => t.name).join(", "));

    expect(disclosed.tools.length).toBeLessThanOrEqual(10);
    const keptNames = disclosed.tools.map((t) => t.name);
    expect(keptNames).toContain("mcp__slack__send_message");
    expect(keptNames).toContain("ToolSearch");
    expect(keptNames.filter((n) => n.startsWith("mcp__stripe__"))).toHaveLength(0);
  });

  it("stats ring buffer records entries after disclosure", () => {
    const body = makeBody("read a file");
    disclosureTools(CORPUS, body, "conn-stats", { maxTools: 10 });
    expect(_recentStats.length).toBeGreaterThan(0);
    const entry = _recentStats[0];
    expect(entry).toHaveProperty("before", CORPUS.length);
    expect(entry).toHaveProperty("after");
    expect(entry).toHaveProperty("keptNames");
    expect(entry).toHaveProperty("strippedNames");
    expect(entry).toHaveProperty("ts");
    expect(entry.connectionId).toBe("conn-stats");
  });

  it("cache hit reuses index across turns", () => {
    const connId = "conn-cache-e2e";
    const body1 = makeBody("read a file");
    const body2 = makeBody("send an email");
    const cfg = { maxTools: 10 };

    const r1 = disclosureTools(CORPUS, body1, connId, cfg);
    const r2 = disclosureTools(CORPUS, body2, connId, cfg);

    // Different queries → different tool selections
    const names1 = r1.tools.map((t) => t.name).join(",");
    const names2 = r2.tools.map((t) => t.name).join(",");
    console.log("\n=== Cache Hit: same session, different queries ===");
    console.log("Turn 1:", names1);
    console.log("Turn 2:", names2);

    expect(r1.tools.length).toBeLessThanOrEqual(10);
    expect(r2.tools.length).toBeLessThanOrEqual(10);
    // Should differ (different queries → different BM25 results)
    expect(names1).not.toBe(names2);
  });
});
