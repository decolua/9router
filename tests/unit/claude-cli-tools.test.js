import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildClaudeCliArgs,
  createClaudeCliContext,
  planClaudeCliInvocation,
  translateClaudeCliEvent,
} from "open-sse/executors/claude-cli.js";
import {
  callerToolName,
  inertMcpServerSource,
  mcpConfigDocument,
  toMcpManifest,
  toolNameMap,
} from "open-sse/executors/claudeCliTools.js";
import { CLAUDE_CLI_MCP_TOOL_PREFIX } from "open-sse/config/claudeCli.js";

/**
 * Tool calling through the Claude Code CLI.
 *
 * The route used to drop the caller's tools on the floor, so an agentic client
 * sent tools, got prose, and waited forever for a call that could not arrive.
 * Claude Code only proposes a tool it can see, and the only way to show it one
 * that is not built in is MCP — hence an inert server that advertises the
 * caller's inventory and executes nothing.
 *
 * The second half is the stream: a turn that ends on a proposal always trips
 * `--max-turns`, which the CLI reports as an error, and reading that as failure
 * cut the response off mid-flight.
 */

const TMP = path.join(os.tmpdir(), `9r-cli-tools-unit-${Date.now()}`);
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const OPENAI_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the weather.",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};

describe("toMcpManifest", () => {
  it("takes the OpenAI tool dialect", () => {
    expect(toMcpManifest([OPENAI_TOOL])).toEqual([{
      name: "get_weather",
      description: "Get the weather.",
      inputSchema: OPENAI_TOOL.function.parameters,
    }]);
  });

  it("takes the Claude dialect too, because either can reach this executor", () => {
    const manifest = toMcpManifest([
      { name: "search", description: "Search.", input_schema: { type: "object", properties: {} } },
    ]);
    expect(manifest[0].name).toBe("search");
    expect(manifest[0].inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("gives a schemaless tool an object schema, which the CLI requires", () => {
    const manifest = toMcpManifest([{ type: "function", function: { name: "ping" } }]);
    expect(manifest[0].inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("drops a duplicate name rather than making the call back ambiguous", () => {
    expect(toMcpManifest([OPENAI_TOOL, OPENAI_TOOL])).toHaveLength(1);
  });

  it("counts two names the CLI would flatten together as one", () => {
    // "a.b" and "a_b" are two tools here and one tool there, because the CLI
    // rewrites the dot — so a call back could be attributed to either.
    const manifest = toMcpManifest([
      { type: "function", function: { name: "a.b" } },
      { type: "function", function: { name: "a_b" } },
    ]);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].name).toBe("a.b");
  });

  it("drops a name that would not survive the CLI's namespacing", () => {
    expect(toMcpManifest([{ type: "function", function: { name: "bad name!" } }])).toEqual([]);
    expect(toMcpManifest([{ type: "function", function: { name: "" } }])).toEqual([]);
  });

  it("budgets the name for what the CLI prepends to it", () => {
    // The CLI renames every MCP tool to `mcp__ninerouter__<name>`, 17 characters
    // more. A name that fits here but not after that is refused upstream, and a
    // rejected inventory takes the whole request with it rather than that tool.
    const room = 128 - CLAUDE_CLI_MCP_TOOL_PREFIX.length;
    expect(toMcpManifest([{ type: "function", function: { name: "a".repeat(room) } }])).toHaveLength(1);
    expect(toMcpManifest([{ type: "function", function: { name: "a".repeat(room + 1) } }])).toEqual([]);
    expect(`${CLAUDE_CLI_MCP_TOOL_PREFIX}${"a".repeat(room)}`.length).toBe(128);
  });

  it("treats anything that is not a list as no tools", () => {
    expect(toMcpManifest(undefined)).toEqual([]);
    expect(toMcpManifest("tools")).toEqual([]);
  });
});

describe("callerToolName", () => {
  it("strips the namespace the CLI adds to every MCP tool", () => {
    expect(callerToolName(`${CLAUDE_CLI_MCP_TOOL_PREFIX}get_weather`)).toBe("get_weather");
  });

  it("leaves a name that was never namespaced alone", () => {
    expect(callerToolName("Read")).toBe("Read");
    expect(callerToolName("")).toBe("");
  });
});

/**
 * A tool name the CLI rewrites on its way in.
 *
 * Measured on 2.1.280: a tool offered as `github.create_issue` is advertised
 * and proposed as `mcp__ninerouter__github_create_issue` — the dot becomes an
 * underscore. Stripping the prefix alone gave the client a call naming a tool
 * it never declared, which it cannot match and cannot answer.
 */
describe("toolNameMap", () => {
  const manifest = toMcpManifest([
    { type: "function", function: { name: "github.create_issue" } },
    { type: "function", function: { name: "get_weather" } },
    { type: "function", function: { name: "get-weather" } },
  ]);
  const names = toolNameMap(manifest);

  it("recovers a dotted name the CLI flattened", () => {
    expect(callerToolName(`${CLAUDE_CLI_MCP_TOOL_PREFIX}github_create_issue`, names))
      .toBe("github.create_issue");
  });

  it("leaves a name the CLI did not change", () => {
    expect(callerToolName(`${CLAUDE_CLI_MCP_TOOL_PREFIX}get_weather`, names)).toBe("get_weather");
    expect(callerToolName(`${CLAUDE_CLI_MCP_TOOL_PREFIX}get-weather`, names)).toBe("get-weather");
  });

  it("falls back to stripping the prefix for anything it has never heard of", () => {
    expect(callerToolName(`${CLAUDE_CLI_MCP_TOOL_PREFIX}other`, names)).toBe("other");
    expect(callerToolName("Bash", names)).toBe("Bash");
    expect(callerToolName(`${CLAUDE_CLI_MCP_TOOL_PREFIX}other`)).toBe("other");
  });

  it("is empty for a request that advertised nothing", () => {
    expect(toolNameMap([]).size).toBe(0);
    expect(toolNameMap(undefined).size).toBe(0);
  });
});

describe("the generated MCP server", () => {
  const manifest = toMcpManifest([OPENAI_TOOL]);

  /** Speak JSON-RPC to the real generated program, the way the CLI does. */
  const ask = (requests) => new Promise((resolve, reject) => {
    fs.mkdirSync(TMP, { recursive: true });
    const file = path.join(TMP, `server-${Math.random().toString(36).slice(2)}.cjs`);
    fs.writeFileSync(file, inertMcpServerSource(manifest));
    const child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", () => {
      if (err.trim()) return reject(new Error(err.trim().slice(0, 300)));
      resolve(out.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
    });
    child.stdin.end(requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  });

  it("answers initialize and lists exactly the caller's tools", async () => {
    const [init, list] = await ask([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(init.result.capabilities).toEqual({ tools: {} });
    expect(list.result.tools).toEqual(manifest);
  });

  it("refuses to run one, so a model that tries gets an answer and not a hang", async () => {
    const [called] = await ask([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_weather" } },
    ]);
    expect(called.result.isError).toBe(true);
    expect(called.result.content[0].text).toMatch(/inert/i);
  });

  it("cannot be escaped by a tool definition, which comes from the request body", async () => {
    // The manifest is embedded in JavaScript source that the CLI then executes,
    // and a caller controls the description and the schema. A quote and a
    // semicolon in either must stay data.
    const hostile = toMcpManifest([{
      type: "function",
      function: {
        name: "evil_tool",
        description: '"; require("child_process").execSync("exit 9"); //',
        parameters: {
          type: "object",
          properties: { x: { type: "string", description: "};process.exit(99);//" } },
        },
      },
    }]);
    fs.mkdirSync(TMP, { recursive: true });
    const file = path.join(TMP, "server-hostile.cjs");
    fs.writeFileSync(file, inertMcpServerSource(hostile));
    const replies = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 || err.trim()) return reject(new Error(`exit ${code}: ${err.slice(0, 200)}`));
        resolve(out.split("\n").filter(Boolean).map((l) => JSON.parse(l)));
      });
      child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
    });
    // It ran, it exited cleanly, and the hostile text came back as the
    // description it is.
    expect(replies[0].result.tools[0].name).toBe("evil_tool");
    expect(replies[0].result.tools[0].description).toContain("execSync");
  });

  it("shows the schema the caller sent, including a key that is also a JS keyword-ish name", async () => {
    // Written as an object literal, a `__proto__` key becomes a prototype
    // assignment instead of a property, and the key silently vanishes from the
    // inventory the model is shown. Nothing escapes — the program only
    // re-stringifies — but the schema advertised is not the schema sent.
    // Built by parsing, not as a literal: written as one, the key would be a
    // prototype assignment here too and the test would prove nothing.
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"string"}}}',
    );
    const tricky = toMcpManifest([{
      type: "function",
      function: { name: "tricky_tool", parameters: schema },
    }]);
    fs.mkdirSync(TMP, { recursive: true });
    const file = path.join(TMP, "server-proto.cjs");
    fs.writeFileSync(file, inertMcpServerSource(tricky));
    const replies = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.on("error", reject);
      child.on("close", () => resolve(out.split("\n").filter(Boolean).map((l) => JSON.parse(l))));
      child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
    });
    const properties = replies[0].result.tools[0].inputSchema.properties;
    expect(Object.keys(properties).sort()).toEqual(["__proto__", "ok"]);
    // And nothing was assigned to anything's prototype on the way.
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "type")).toBe(false);
  });

  it("says nothing back to a notification, which carries no id", async () => {
    const replies = await ask([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 7, method: "tools/list" },
    ]);
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe(7);
  });

  it("survives a malformed line instead of dying on it", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const file = path.join(TMP, "server-malformed.cjs");
    fs.writeFileSync(file, inertMcpServerSource(manifest));
    const replies = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.on("error", reject);
      child.on("close", () => resolve(out.split("\n").filter(Boolean).map((l) => JSON.parse(l))));
      child.stdin.end(`not json\n${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`);
    });
    expect(replies).toHaveLength(1);
    expect(replies[0].id).toBe(3);
  });
});

describe("mcpConfigDocument", () => {
  it("points the CLI at the generated server with this server's own node", () => {
    const doc = mcpConfigDocument("/usr/bin/node", "/tmp/x/inert-mcp.cjs");
    const server = Object.values(doc.mcpServers)[0];
    expect(server.command).toBe("/usr/bin/node");
    expect(server.args).toEqual(["/tmp/x/inert-mcp.cjs"]);
  });
});

describe("buildClaudeCliArgs", () => {
  it("never leaves the CLI waiting for a human", () => {
    const args = buildClaudeCliArgs({ model: "claude-cli-haiku" });
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--no-session-persistence");
  });

  it("adds the MCP config only when there is one", () => {
    expect(buildClaudeCliArgs({ model: "claude-cli-haiku" })).not.toContain("--mcp-config");
    const withTools = buildClaudeCliArgs({ model: "claude-cli-haiku", mcpConfigFile: "/tmp/mcp.json" });
    expect(withTools[withTools.indexOf("--mcp-config") + 1]).toBe("/tmp/mcp.json");
  });
});

describe("planClaudeCliInvocation", () => {
  it("carries the tools out as a manifest for the spawn to write", () => {
    const plan = planClaudeCliInvocation({
      model: "claude-cli-haiku",
      messages: [{ role: "user", content: "hi" }],
      tools: [OPENAI_TOOL],
    });
    expect(plan.manifest).toHaveLength(1);
    expect(plan.manifest[0].name).toBe("get_weather");
  });

  it("pins the turn limit to one when tools are advertised", () => {
    // A second turn lets the CLI invoke the inert server, read its refusal and
    // answer with an apology — the client never sees the call it was waiting
    // for. The caller does not get to raise that.
    const plan = planClaudeCliInvocation({
      model: "claude-cli-haiku",
      messages: [{ role: "user", content: "hi" }],
      tools: [OPENAI_TOOL],
      maxTurns: 5,
    });
    expect(plan.args[plan.args.indexOf("--max-turns") + 1]).toBe("1");
  });

  it("answers in one turn whether or not tools were advertised", () => {
    // It used to honour a caller's max_turns when no tools were advertised —
    // a 9Router extension the Hermes plugin does not have, and one that cannot
    // coexist with a cache relay that admits exactly one model call. An agent
    // loop belongs to the client; this endpoint answers once.
    for (const tools of [undefined, [{ type: "function", function: { name: "f" } }]]) {
      const plan = planClaudeCliInvocation({
        model: "claude-cli-haiku",
        messages: [{ role: "user", content: "hi" }],
        maxTurns: 5,
        tools,
      });
      expect(plan.args[plan.args.indexOf("--max-turns") + 1], String(tools)).toBe("1");
    }
  });

  it("reports no manifest for a request with no tools, so nothing extra spawns", () => {
    const plan = planClaudeCliInvocation({
      model: "claude-cli-haiku",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(plan.manifest).toEqual([]);
  });
});

describe("translating a proposed tool call", () => {
  let ctx;
  beforeEach(() => { ctx = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" }); });

  const streamEvent = (event) => translateClaudeCliEvent({ type: "stream_event", event }, ctx);
  const deltasOf = (frames) => frames
    .map((f) => { try { return JSON.parse(f.replace(/^data: /, "").trim()); } catch { return null; } })
    .filter(Boolean)
    .map((f) => f.choices?.[0]?.delta)
    .filter(Boolean);

  const openCall = (index = 1, name = `${CLAUDE_CLI_MCP_TOOL_PREFIX}get_weather`) => streamEvent({
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id: "toolu_1", name, input: {} },
  });

  it("opens the call as soon as the block starts, under the caller's own name", () => {
    const [delta] = deltasOf(openCall().frames);
    expect(delta.role).toBe("assistant");
    expect(delta.tool_calls[0]).toMatchObject({
      index: 0,
      id: "toolu_1",
      type: "function",
      function: { name: "get_weather", arguments: "" },
    });
  });

  it("streams the argument fragments onto that call", () => {
    openCall();
    const frames = [
      streamEvent({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"city":' } }),
      streamEvent({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Seoul"}' } }),
    ].flatMap((r) => r.frames);
    const joined = deltasOf(frames).map((d) => d.tool_calls[0].function.arguments).join("");
    expect(JSON.parse(joined)).toEqual({ city: "Seoul" });
    expect(deltasOf(frames).every((d) => d.tool_calls[0].index === 0)).toBe(true);
  });

  it("keeps two calls apart by the block they came from", () => {
    openCall(1, `${CLAUDE_CLI_MCP_TOOL_PREFIX}get_weather`);
    openCall(2, `${CLAUDE_CLI_MCP_TOOL_PREFIX}search`);
    const first = deltasOf(streamEvent({
      type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "a" },
    }).frames)[0];
    const second = deltasOf(streamEvent({
      type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "b" },
    }).frames)[0];
    expect(first.tool_calls[0].index).toBe(0);
    expect(second.tool_calls[0].index).toBe(1);
  });

  it("ignores a fragment for a block that never opened a call", () => {
    const { frames } = streamEvent({
      type: "content_block_delta", index: 9, delta: { type: "input_json_delta", partial_json: "x" },
    });
    expect(frames).toEqual([]);
  });

  it("still streams text and thinking the way it always did", () => {
    const text = deltasOf(streamEvent({
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" },
    }).frames)[0];
    expect(text).toMatchObject({ role: "assistant", content: "hello" });
    const thinking = deltasOf(streamEvent({
      type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" },
    }).frames)[0];
    expect(thinking.reasoning_content).toBe("hmm");
  });
});

describe("the complete assistant message", () => {
  let ctx;
  beforeEach(() => { ctx = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" }); });

  const deltasOf = (frames) => frames
    .map((f) => { try { return JSON.parse(f.replace(/^data: /, "").trim()); } catch { return null; } })
    .filter(Boolean)
    .map((f) => f.choices?.[0]?.delta)
    .filter(Boolean);

  const assistant = (content) => translateClaudeCliEvent({ type: "assistant", message: { content } }, ctx);

  // A response that carried output tokens and no content at all reaches a
  // client as an assistant turn with nothing in it and nothing to do — which is
  // an agent that keeps trying and never gets anywhere.
  it("carries the answer when no delta arrived", () => {
    const deltas = deltasOf(assistant([{ type: "text", text: "hello" }]).frames);
    expect(deltas[0]).toMatchObject({ role: "assistant", content: "hello" });
  });

  it("carries a tool call when no delta arrived, with its arguments whole", () => {
    const deltas = deltasOf(assistant([
      { type: "tool_use", id: "toolu_1", name: `${CLAUDE_CLI_MCP_TOOL_PREFIX}get_weather`, input: { city: "Seoul" } },
    ]).frames);
    expect(deltas[0].tool_calls[0]).toMatchObject({
      index: 0, id: "toolu_1", type: "function",
      function: { name: "get_weather", arguments: '{"city":"Seoul"}' },
    });
  });

  it("adds nothing when the deltas already carried it", () => {
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    }, ctx);
    expect(assistant([{ type: "text", text: "hi" }]).frames).toEqual([]);
  });

  it("does not send a tool call twice, whichever form arrived first", () => {
    translateClaudeCliEvent({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "f", input: {} },
      },
    }, ctx);
    expect(assistant([{ type: "tool_use", id: "toolu_1", name: "f", input: {} }]).frames).toEqual([]);
  });

  it("carries a second block that never streamed, alongside one that did", () => {
    // Measured order is deltas then the complete block, so a bare "did any
    // text stream?" flag would have dropped this one.
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "first" } },
    }, ctx);
    const deltas = deltasOf(assistant([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]).frames);
    expect(deltas.map((d) => d.content)).toEqual(["second"]);
  });

  it("returns a call that carries no id, rather than dropping it", () => {
    // The streamed path makes an id up; requiring one here dropped the call in
    // silence, which is a client waiting for something that never arrives.
    const deltas = deltasOf(assistant([
      { type: "tool_use", name: "f", input: { a: 1 } },
    ]).frames);
    expect(deltas[0].tool_calls[0]).toMatchObject({
      index: 0, type: "function", function: { name: "f", arguments: '{"a":1}' },
    });
    expect(deltas[0].tool_calls[0].id).toBeTruthy();
  });

  it("numbers two calls apart, whether or not they carry ids", () => {
    const deltas = deltasOf(assistant([
      { type: "tool_use", name: "f", input: {} },
      { type: "tool_use", id: "toolu_2", name: "g", input: {} },
    ]).frames);
    expect(deltas.map((d) => d.tool_calls[0].index)).toEqual([0, 1]);
    expect(new Set(deltas.map((d) => d.tool_calls[0].id)).size).toBe(2);
  });

  it("does not send an id-less call twice when its streamed copy already went", () => {
    // The streamed copy went out under a made-up id, so the id cannot match it
    // here. Accepting the block anyway would have the client run the tool
    // twice — which is worse than the dropped call the id-less branch fixes.
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "f" } },
    }, ctx);
    expect(assistant([{ type: "tool_use", name: "f", input: { a: 1 } }]).frames).toEqual([]);
  });

  it("ignores thinking, which is not an answer to act on", () => {
    expect(assistant([{ type: "thinking", thinking: "hmm", signature: "x" }]).frames).toEqual([]);
  });

  it("starts each message with a clean slate, so blocks do not cross the boundary", () => {
    // Content-block indices restart at 0 with each message. A mapping or a text
    // buffer left over from the last one routes this message's fragments onto
    // the previous message's call, or suppresses a block that merely repeats a
    // phrase it already saw.
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } },
    }, ctx);
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Okay." } },
    }, ctx);
    expect(ctx.toolBlocks.size).toBe(1);
    expect(ctx.streamedText).toBe("Okay.");

    translateClaudeCliEvent({ type: "stream_event", event: { type: "message_start", message: {} } }, ctx);
    expect(ctx.toolBlocks.size).toBe(0);
    expect(ctx.streamedText).toBe("");

    // So the second message's "Okay." is its own, not a repeat to suppress.
    const deltas = deltasOf(assistant([{ type: "text", text: "Okay." }]).frames);
    expect(deltas[0].content).toBe("Okay.");
  });

  it("never ends the stream on its own — only the result does that", () => {
    expect(assistant([{ type: "text", text: "hello" }]).finished).toBe(false);
  });
});

describe("the result event after a tool call", () => {
  let ctx;
  beforeEach(() => { ctx = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" }); });

  const parsed = (frames) => frames
    .map((f) => { try { return JSON.parse(f.replace(/^data: /, "").trim()); } catch { return null; } })
    .filter(Boolean);

  // The exact result the CLI sends when a turn ends by proposing a call.
  const MAX_TURNS_ON_TOOL = {
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    stop_reason: "tool_use",
    num_turns: 2,
  };

  it("is a completion, not an error: the call is what the client asked for", () => {
    ctx.sawToolCall = true;
    ctx.stopReason = "tool_use";
    const { frames, finished } = translateClaudeCliEvent(MAX_TURNS_ON_TOOL, ctx);
    expect(finished).toBe(true);
    const events = parsed(frames);
    expect(events.some((e) => e.error)).toBe(false);
    expect(events.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  // Replay sends the history as frames marked `shouldQuery: false`, and the CLI
  // acknowledges each one with its own `result` — no turns, no tokens, no
  // content. Taking the first of those as the end closes the stream before the
  // model has been asked anything, which is an empty 200 for every
  // conversation that has a history at all.
  it("ignores the acknowledgment of a replayed turn", () => {
    for (const ack of [
      { type: "result", subtype: "success", num_turns: 0, result: "" },
      { type: "result", subtype: "success", num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } },
    ]) {
      const fresh = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" });
      const { frames, finished } = translateClaudeCliEvent(ack, fresh);
      expect(finished, JSON.stringify(ack)).toBe(false);
      expect(frames).toEqual([]);
    }
  });

  it("does not take an error for an acknowledgment, whatever its turn count", () => {
    // The CLI reports a startup failure with no turns at all. Swallowing it
    // here left the request to end as a bare "exited before completing", with
    // the reason the CLI gave thrown away.
    const { frames, finished } = translateClaudeCliEvent({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 0,
      errors: ["credentials are not valid"],
    }, ctx);
    expect(finished).toBe(true);
    expect(parsed(frames)[0].error.message).toContain("credentials are not valid");
  });

  it("does end on the result that did query, after those acknowledgments", () => {
    translateClaudeCliEvent({ type: "result", subtype: "success", num_turns: 0 }, ctx);
    translateClaudeCliEvent({ type: "result", subtype: "success", num_turns: 0 }, ctx);
    const { finished } = translateClaudeCliEvent(
      { type: "result", subtype: "success", num_turns: 1, result: "hello" }, ctx,
    );
    expect(finished).toBe(true);
  });

  // An error frame carries no `choices`, and openaiToClaudeResponse returns
  // null for any chunk without `choices[0]`. So for a Claude- or Gemini-format
  // client every failure here used to be silence: the stream ended with no
  // content and no finish_reason, which an agent reads as an empty turn and
  // retries — forever.
  it("says what went wrong in a form every client format carries", () => {
    const deltas = parsed(translateClaudeCliEvent({
      type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1,
      errors: ["the upstream refused the request"],
    }, ctx).frames).filter((f) => f.choices);
    expect(deltas[0].choices[0].delta.role).toBe("assistant");
    expect(deltas[0].choices[0].delta.content).toContain("the upstream refused the request");
    expect(deltas.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("reports a turn that ended having produced nothing, rather than passing it on", () => {
    // Measured: a turn that only thought returns subtype success with an empty
    // result. Delivered as-is that is an assistant message with nothing in it,
    // which is the shape an agent cannot make progress on.
    const { frames, finished } = translateClaudeCliEvent(
      { type: "result", subtype: "success", is_error: false, num_turns: 1, result: "" }, ctx,
    );
    expect(finished).toBe(true);
    const events = parsed(frames);
    expect(events[0].error.code).toBe("empty_response");
    expect(events.find((e) => e.choices)?.choices[0].delta.content).toContain("without producing");
  });

  it("leaves a turn that stopped for a stated reason alone, empty or not", () => {
    // A token ceiling, a stop sequence or a refusal already say on the finish
    // chunk why there is nothing; calling those empty would turn an answer
    // into a failure.
    for (const stopReason of ["max_tokens", "stop_sequence", "refusal"]) {
      const fresh = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" });
      fresh.stopReason = stopReason;
      const events = parsed(translateClaudeCliEvent(
        { type: "result", subtype: "success", num_turns: 1, result: "" }, fresh,
      ).frames);
      expect(events.some((e) => e.error), stopReason).toBe(false);
    }
  });

  it("is still an error when the turns ran out with no call to show for it", () => {
    const { frames } = translateClaudeCliEvent(
      { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 2 },
      ctx,
    );
    expect(parsed(frames)[0].error.code).toBe("error_max_turns");
  });

  it("reports the caller's token ceiling as a completion that stopped, not a failure", () => {
    // The API calls this stop_reason "max_tokens"; the CLI calls it an error,
    // because it is an agent that ran out of room. Passing that on would turn
    // every bounded request into a failure — and max_tokens is required by the
    // Messages API, so every Anthropic client sends one.
    const { frames, finished } = translateClaudeCliEvent({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "API Error: Claude's response exceeded the 32 output token maximum. "
        + "To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.",
    }, ctx);
    expect(finished).toBe(true);
    const events = parsed(frames);
    expect(events.some((e) => e.error)).toBe(false);
    expect(events.at(-1).choices[0].finish_reason).toBe("length");
  });

  it("answers from the result when the turn produced only thinking", () => {
    // Thinking opens a message and says nothing an agent can act on. Keying the
    // fallback on "a message was opened" meant such a turn reached the client
    // empty, and the client retried the same step forever.
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
    }, ctx);
    const { frames } = translateClaudeCliEvent(
      { type: "result", subtype: "success", is_error: false, result: "the answer" },
      ctx,
    );
    const contents = parsed(frames)
      .map((e) => e.choices?.[0]?.delta?.content)
      .filter(Boolean);
    expect(contents).toContain("the answer");
  });

  it("does not repeat the answer when it already streamed", () => {
    translateClaudeCliEvent({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "the answer" } },
    }, ctx);
    const { frames } = translateClaudeCliEvent(
      { type: "result", subtype: "success", is_error: false, result: "the answer" },
      ctx,
    );
    expect(parsed(frames).some((e) => e.choices?.[0]?.delta?.content)).toBe(false);
  });

  it("still refuses to pass off an upstream failure as an answer", () => {
    const { frames } = translateClaudeCliEvent(
      { type: "result", subtype: "success", is_error: true, result: "Overloaded" },
      ctx,
    );
    expect(parsed(frames)[0].error.message).toBe("Overloaded");
  });

  it("takes the stop reason from the result when no message_delta carried one", () => {
    ctx.sawToolCall = true;
    const { frames } = translateClaudeCliEvent(MAX_TURNS_ON_TOOL, ctx);
    expect(parsed(frames).at(-1).choices[0].finish_reason).toBe("tool_calls");
  });
});
