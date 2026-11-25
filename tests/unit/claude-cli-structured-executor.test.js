import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCliExecutor } from "open-sse/executors/claude-cli.js";
import { parseSSEToOpenAIResponse } from "open-sse/handlers/chatCore/sseToJsonHandler.js";

/**
 * `response_format` through ClaudeCliExecutor.execute(), with a stand-in
 * `claude` that records how it was called and answers the way the real 2.1.285
 * does under `--json-schema` (measured: a StructuredOutput tool call, then a
 * result carrying `structured_output`).
 *
 * The translator tests build their context by hand, so they cannot notice
 * execute() forgetting to ask for structured handling. This is what pins the
 * wiring: the flag reaching argv, the context being told, the session cache
 * staying out of it, and a failure reaching a non-streaming client with a
 * status the account loop will not lock on.
 *
 * Runs on Windows and POSIX alike. A `.cmd` is resolved to the package's own
 * cli.js and run under this process's Node (see buildSpawnPlan); elsewhere the
 * stand-in is an executable script.
 */

let root;
let binDir;
let configDir;
const saved = {};

const standIn = () => `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(root)};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  fs.appendFileSync(path.join(ROOT, "calls.jsonl"), JSON.stringify({ args }) + "\\n");
  let mode = "";
  try { mode = fs.readFileSync(path.join(ROOT, "mode.txt"), "utf8").trim(); } catch {}
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  const usage = { input_tokens: 5, output_tokens: 7 };
  if (args.includes("--json-schema")) {
    if (mode === "no-output") {
      say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "I would rather not.", usage });
      return;
    }
    if (mode === "gave-up") {
      say({ type: "result", subtype: "error_max_structured_output_retries", is_error: true, num_turns: 2, stop_reason: "tool_use", usage });
      return;
    }
    say({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "StructuredOutput", input: {} } } });
    say({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_1", name: "StructuredOutput", input: { answer: 4 } }], stop_reason: null } });
    say({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "tool_use" } } });
    say({ type: "result", subtype: "success", is_error: false, num_turns: 2, stop_reason: "tool_use", result: "{\\"answer\\":4}", structured_output: { answer: 4 }, usage });
    return;
  }
  say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "plain answer" } } });
  say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "plain answer", usage });
});
`;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-structured-exec-"));
  binDir = path.join(root, "bin");
  configDir = path.join(root, "config");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  let bin;
  if (process.platform === "win32") {
    bin = path.join(binDir, "claude.cmd");
    fs.writeFileSync(bin, "@echo off\r\n");
    const pkg = path.join(binDir, "node_modules", "@anthropic-ai", "claude-code");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "cli.js"), standIn());
  } else {
    bin = path.join(binDir, "claude");
    fs.writeFileSync(bin, standIn());
    fs.chmodSync(bin, 0o755);
  }
  for (const key of ["CLI_CLAUDE_BIN", "CLI_CLAUDE_SESSION_CACHE", "CLI_CLAUDE_CACHE_RELAY"]) saved[key] = process.env[key];
  process.env.CLI_CLAUDE_BIN = bin;
  process.env.CLI_CLAUDE_SESSION_CACHE = "1";
  process.env.CLI_CLAUDE_CACHE_RELAY = "0";
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  globalThis.__claudeCliSessions = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.__claudeCliSessions = undefined;
  fs.rmSync(path.join(root, "calls.jsonl"), { force: true });
  fs.rmSync(path.join(root, "mode.txt"), { force: true });
});

const calls = () => (fs.existsSync(path.join(root, "calls.jsonl"))
  ? fs.readFileSync(path.join(root, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  : []);
const mode = (m) => fs.writeFileSync(path.join(root, "mode.txt"), m);

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "number" } },
  required: ["answer"],
  additionalProperties: false,
};
const JSON_SCHEMA_FORMAT = { type: "json_schema", json_schema: { name: "math", strict: true, schema: SCHEMA } };
const ONE_TURN = [{ role: "user", content: "What is 2+2?" }];

async function ask(body) {
  const logs = [];
  const { response } = await new ClaudeCliExecutor().execute({
    model: "claude-cli-haiku",
    body,
    credentials: { providerSpecificData: { configDir } },
    log: { info: (_tag, message) => logs.push(message) },
  });
  const text = await response.text();
  // Let the close handler settle the session before the next request.
  await new Promise((r) => setTimeout(r, 100));
  const events = text.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
  return {
    status: response.status,
    text,
    logs,
    events,
    content: events.map((e) => e.choices?.[0]?.delta?.content).filter((c) => typeof c === "string").join(""),
    toolCalls: events.flatMap((e) => e.choices?.[0]?.delta?.tool_calls || []),
    finish: events.map((e) => e.choices?.[0]?.finish_reason).filter(Boolean).at(-1),
  };
}

describe("response_format through the executor", () => {
  it("spawns the CLI with the caller's schema and answers with the JSON alone", async () => {
    const out = await ask({ messages: ONE_TURN, response_format: JSON_SCHEMA_FORMAT });
    expect(out.status).toBe(200);

    const { args } = calls()[0];
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual(SCHEMA);
    // The gateway's invariants hold for a structured turn too.
    expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
    expect(args[args.indexOf("--tools") + 1]).toBe("");

    expect(JSON.parse(out.content)).toEqual({ answer: 4 });
    // The stand-in's StructuredOutput call reaches the client only if execute()
    // failed to tell the translator this turn was structured.
    expect(out.toolCalls).toEqual([]);
    expect(out.finish).toBe("stop");
    expect(out.logs.join("\n")).toMatch(/structured output/);
  });

  it("sends json_object as the loosest schema that still forces an object", async () => {
    const out = await ask({ messages: ONE_TURN, response_format: { type: "json_object" } });
    const { args } = calls()[0];
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual({ type: "object" });
    expect(JSON.parse(out.content)).toEqual({ answer: 4 });
  });

  it("leaves an ordinary request exactly as it was", async () => {
    const out = await ask({ messages: ONE_TURN });
    expect(calls()[0].args).not.toContain("--json-schema");
    expect(out.content).toBe("plain answer");
    expect(out.finish).toBe("stop");
  });

  it("runs a structured turn without a session, where the same request otherwise gets one", async () => {
    // The CLI files a structured turn's transcript with its own StructuredOutput
    // call in it, which is not what the client's history says happened.
    const plain = await ask({ messages: ONE_TURN });
    expect(plain.status).toBe(200);
    const plainArgs = calls()[0].args;
    expect(plainArgs).toContain("--session-id");

    globalThis.__claudeCliSessions = undefined;
    const structured = await ask({ messages: ONE_TURN, response_format: JSON_SCHEMA_FORMAT });
    const structuredArgs = calls()[1].args;
    expect(structuredArgs).toContain("--no-session-persistence");
    expect(structuredArgs).not.toContain("--session-id");
    expect(structuredArgs).not.toContain("--resume");
    // Said in the log, so the lost prompt caching is not a mystery.
    expect(structured.logs.join("\n")).toMatch(/session cache skipped.*structured/i);
  });

  it("refuses structured output together with tools, and spawns nothing", async () => {
    const out = await ask({
      messages: ONE_TURN,
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
      response_format: { type: "json_object" },
    });
    expect(out.status).toBe(400);
    expect(out.text).toContain("unsupported_response_format_with_tools");
    expect(calls()).toEqual([]);
  });

  it("refuses a schema it cannot send, and spawns nothing", async () => {
    const out = await ask({
      messages: ONE_TURN,
      response_format: { type: "json_schema", json_schema: { name: "x", schema: { type: "array" } } },
    });
    expect(out.status).toBe(400);
    expect(out.text).toContain("invalid_response_format");
    expect(calls()).toEqual([]);
  });
});

describe("a structured turn that fails, for a non-streaming client", () => {
  // chat.js drives account lock and failover off the status this ends up as.
  const folded = (out) => parseSSEToOpenAIResponse(out.text, "claude-cli-haiku");

  it("reports a missing output with a request-scoped status", async () => {
    mode("no-output");
    const out = await ask({ messages: ONE_TURN, response_format: JSON_SCHEMA_FORMAT });
    expect(folded(out).error).toMatchObject({ code: "structured_output_missing", status: 422 });
  });

  it("reports a CLI that gave up validating with a request-scoped status", async () => {
    mode("gave-up");
    const out = await ask({ messages: ONE_TURN, response_format: JSON_SCHEMA_FORMAT });
    expect(folded(out).error).toMatchObject({ code: "error_max_structured_output_retries", status: 422 });
  });
});
