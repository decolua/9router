import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCliExecutor } from "open-sse/executors/claude-cli.js";

/**
 * The session cache through the executor itself, with a stand-in `claude`
 * that records how it was called. What is pinned here is what the CLI is
 * asked to do — create, resume, or run fresh — and that a resume which finds
 * nothing is still answered, once, without the client seeing the miss.
 *
 * The real binary's behaviour (a resumed turn repeats the previous prefix, and
 * the cache hits) is measured, not assumed, by
 * scripts/fork/check-claude-cli-resume-cache.mjs.
 */

const STAND_IN = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const dir = path.dirname(process.argv[1]);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const calls = path.join(dir, "calls.jsonl");
  const n = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\\n").filter(Boolean).length + 1 : 1;
  fs.appendFileSync(calls, JSON.stringify({ args, frames: input.trim().split("\\n").filter(Boolean).length }) + "\\n");
  let mode = "";
  try { mode = fs.readFileSync(path.join(dir, "mode.txt"), "utf8").trim(); } catch {}
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  const resume = args.includes("--resume");
  const sid = args[args.indexOf(resume ? "--resume" : "--session-id") + 1];
  // A resumed run whose transcript this process seeded: record what the
  // transcript held, so a test can see the history went in as a transcript.
  if (resume && fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR, "projects"))) {
    const projects = path.join(process.env.CLAUDE_CONFIG_DIR, "projects");
    for (const d of fs.readdirSync(projects)) {
      const f = path.join(projects, d, sid + ".jsonl");
      if (fs.existsSync(f)) {
        const recs = fs.readFileSync(f, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l));
        fs.appendFileSync(path.join(dir, "seeded.jsonl"), JSON.stringify({ sid, records: recs.length, roles: recs.map((r) => r.type) }) + "\\n");
      }
    }
  }
  if (resume && mode === "missing") {
    say({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, errors: ["No conversation found with session ID: " + sid] });
    process.exit(1);
  }
  if (resume && mode === "crash") {
    process.stderr.write("some other failure");
    process.exit(1);
  }
  if (!resume && mode === "tool") {
    say({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "mcp__ninerouter__get_weather", input: { city: "Seoul" } }] } });
    say({ type: "result", subtype: "error_max_turns", is_error: true, stop_reason: "tool_use", num_turns: 2, usage: { input_tokens: 5, output_tokens: 2 } });
    return;
  }
  if (!resume && mode === "empty") {
    say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "",
      usage: { input_tokens: 5, output_tokens: 0 } });
    return;
  }
  if (resume && mode === "slow-missing") {
    // Says the session is gone, but only after the client has had time to leave.
    setTimeout(() => {
      say({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, errors: ["No conversation found with session ID: " + sid] });
      process.exit(1);
    }, 400);
    return;
  }
  if (resume && mode === "delta-then-missing") {
    say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } } });
    say({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1, errors: ["No conversation found with session ID: " + sid] });
    process.exit(1);
  }
  if (args.includes("--session-id") && mode !== "no-persist") {
    const project = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"));
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, sid + ".jsonl"), "{}\\n");
  }
  say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answer-" + n } } });
  say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "answer-" + n,
    usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 100 } });
});
`;

let root;
let binDir;
let configDir;
const saved = {};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-session-exec-"));
  binDir = path.join(root, "bin");
  configDir = path.join(root, "config");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  const bin = path.join(binDir, "claude");
  fs.writeFileSync(bin, STAND_IN);
  fs.chmodSync(bin, 0o755);
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
  fs.rmSync(path.join(binDir, "calls.jsonl"), { force: true });
  fs.rmSync(path.join(binDir, "mode.txt"), { force: true });
  fs.rmSync(path.join(binDir, "seeded.jsonl"), { force: true });
});

const calls = () => fs.readFileSync(path.join(binDir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const mode = (m) => fs.writeFileSync(path.join(binDir, "mode.txt"), m);
const seeded = () => (fs.existsSync(path.join(binDir, "seeded.jsonl")) ? fs.readFileSync(path.join(binDir, "seeded.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

async function ask(messages) {
  const executor = new ClaudeCliExecutor();
  const { response } = await executor.execute({
    model: "claude-cli-haiku",
    body: { messages, stream: true },
    credentials: { providerSpecificData: { configDir } },
    log: { info() {} },
  });
  const text = await response.text();
  const content = text.split("\n").filter((l) => l.startsWith("data: {"))
    .map((l) => JSON.parse(l.slice(6))).map((c) => c.choices?.[0]?.delta?.content || "").join("");
  // Let the close handler settle the session before the next request.
  await new Promise((r) => setTimeout(r, 100));
  return { text, content };
}

const SYSTEM = { role: "system", content: "be brief" };

describe("the claude-cli session cache, through the executor", () => {
  it("creates a session, then resumes it with the newest turn alone", async () => {
    const first = await ask([SYSTEM, { role: "user", content: "q1" }]);
    expect(first.content).toBe("answer-1");
    const second = await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: first.content }, { role: "user", content: "q2" }]);
    expect(second.content).toBe("answer-2");

    const [c1, c2] = calls();
    const id = c1.args[c1.args.indexOf("--session-id") + 1];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c1.args).not.toContain("--no-session-persistence");
    expect(c2.args[c2.args.indexOf("--resume") + 1]).toBe(id);
    expect(c2.frames).toBe(1);
  });

  it("seeds a history it did not answer as a transcript, and resumes that with the newest turn alone", async () => {
    await ask([SYSTEM, { role: "user", content: "q1" }]);
    await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: "something else" }, { role: "user", content: "q2" }]);
    const [, c2] = calls();
    // Not the session it answered before (the history differs), and not the
    // whole conversation on stdin either: the history went in as a transcript
    // this process wrote, so the model sees it in order.
    expect(c2.args).toContain("--resume");
    expect(c2.args).not.toContain("--session-id");
    expect(c2.frames).toBe(1);
    const [s] = seeded();
    expect(s.records).toBe(2);
    expect(s.roles).toEqual(["user", "assistant"]);
    expect(c2.args[c2.args.indexOf("--resume") + 1]).toBe(s.sid);
  });

  it("still runs the whole conversation on stdin when the query is a tool result", async () => {
    await ask([SYSTEM, { role: "user", content: "weather?" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "get_weather", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: "sunny" }]);
    const [c1] = calls();
    expect(c1.args).toContain("--session-id");
    expect(c1.args).not.toContain("--resume");
    expect(c1.frames).toBe(3);
    expect(seeded()).toEqual([]);
  });

  it("falls back to the plain replay, once, when the seeded transcript is refused", async () => {
    mode("missing");
    const r = await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "user", content: "q2" }]);
    const log = calls();
    expect(log).toHaveLength(2);
    expect(log[0].args).toContain("--resume");
    expect(log[1].args).toContain("--session-id");
    expect(log[1].frames).toBe(3);
    expect(r.content).toBe("answer-2");
  });

  it("answers in full, once, when the session to resume is gone", async () => {
    const first = await ask([SYSTEM, { role: "user", content: "q1" }]);
    mode("missing");
    const second = await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: first.content }, { role: "user", content: "q2" }]);
    const log = calls();
    expect(log).toHaveLength(3);
    expect(log[1].args).toContain("--resume");
    // The fresh run: a new session, and the whole conversation.
    expect(log[2].args).toContain("--session-id");
    expect(log[2].args[log[2].args.indexOf("--session-id") + 1]).not.toBe(log[0].args[log[0].args.indexOf("--session-id") + 1]);
    expect(log[2].frames).toBe(3);
    expect(second.content).toBe("answer-3");
    expect(second.text).not.toMatch(/No conversation found/);
  });

  it("also runs fresh when a resume fails some other way before answering", async () => {
    const first = await ask([SYSTEM, { role: "user", content: "q1" }]);
    mode("crash");
    const second = await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: first.content }, { role: "user", content: "q2" }]);
    const log = calls();
    expect(log).toHaveLength(3);
    expect(log[2].args).toContain("--session-id");
    expect(second.content).toBe("answer-3");
  });

  it("does not continue a turn that delivered nothing", async () => {
    mode("empty");
    await ask([SYSTEM, { role: "user", content: "q1" }]);
    mode("");
    await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: "" }, { role: "user", content: "q2" }]);
    const [c1, c2] = calls();
    // The second turn did not resume the first turn's session; it ran on a
    // transcript this process seeded from the client's history instead.
    const first = c1.args[c1.args.indexOf("--session-id") + 1];
    expect(c2.args[c2.args.indexOf("--resume") + 1]).not.toBe(first);
    expect(seeded().map((s) => s.sid)).toContain(c2.args[c2.args.indexOf("--resume") + 1]);
  });

  it("never continues a turn that ended in a tool call: the tool result replays fresh", async () => {
    // The CLI records its own denial for the call in the transcript; a resumed
    // turn carrying the client's result would be dropped as a duplicate.
    const TOOLS = [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: {} } } }];
    mode("tool");
    const executor = new ClaudeCliExecutor();
    const { response } = await executor.execute({
      model: "claude-cli-haiku", body: { messages: [SYSTEM, { role: "user", content: "weather?" }], tools: TOOLS, stream: true },
      credentials: { providerSpecificData: { configDir } }, log: { info() {} },
    });
    const text = await response.text();
    expect(text).toMatch(/get_weather/);
    await new Promise((r) => setTimeout(r, 100));
    mode("");
    await ask([SYSTEM, { role: "user", content: "weather?" },
      { role: "assistant", content: null, tool_calls: [{ id: "toolu_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Seoul\"}" } }] },
      { role: "tool", tool_call_id: "toolu_1", content: "sunny" }]);
    const [c1, c2] = calls();
    expect(c1.args).toContain("--session-id");
    expect(c2.args).not.toContain("--resume");
    expect(c2.args).toContain("--session-id");
    expect(c2.frames).toBe(3);
    // And the tool-call turn's transcript is gone, not waiting for a TTL.
    const first = c1.args[c1.args.indexOf("--session-id") + 1];
    const projects = path.join(configDir, "projects");
    const files = fs.readdirSync(projects).flatMap((d) => fs.readdirSync(path.join(projects, d)));
    expect(files).not.toContain(`${first}.jsonl`);
  });

  it("does not run it again once something reached the client", async () => {
    const first = await ask([SYSTEM, { role: "user", content: "q1" }]);
    mode("delta-then-missing");
    await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: first.content }, { role: "user", content: "q2" }]);
    expect(calls()).toHaveLength(2);
  });

  it("gives the slot and the request files back when the client leaves during the retry", async () => {
    const first = await ask([SYSTEM, { role: "user", content: "q1" }]);
    mode("slow-missing");
    const executor = new ClaudeCliExecutor();
    const controller = new AbortController();
    const { response } = await executor.execute({
      model: "claude-cli-haiku",
      body: { messages: [SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: first.content }, { role: "user", content: "q2" }], stream: true },
      credentials: { providerSpecificData: { configDir } },
      signal: controller.signal,
      log: { info() {} },
    });
    // Leave before the resumed child has said anything.
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await response.text();
    await new Promise((r) => setTimeout(r, 1500));
    // No client to answer, so no fresh run is started for it; the slot comes
    // back, and the session it was resuming is discarded rather than left on
    // disk with nothing to expire it.
    const { claudeCliGateStats } = await import("open-sse/executors/claude-cli.js");
    expect(claudeCliGateStats().active).toBe(0);
    const [c1] = calls();
    const abandoned = c1.args[c1.args.indexOf("--session-id") + 1];
    const projects = path.join(configDir, "projects");
    const transcripts = fs.readdirSync(projects).flatMap((d) => fs.readdirSync(path.join(projects, d)));
    expect(transcripts).not.toContain(`${abandoned}.jsonl`);
  });

  it("turns itself off for the process when a session's transcript is not where it looks", async () => {
    mode("no-persist");
    const first = await ask([SYSTEM, { role: "user", content: "q1" }]);
    expect(first.content).toBe("answer-1");
    mode("");
    await ask([SYSTEM, { role: "user", content: "q1" }, { role: "assistant", content: first.content }, { role: "user", content: "q2" }]);
    const [c1, c2] = calls();
    expect(c1.args).toContain("--session-id");
    // Not resumed, and not a new session either: back to today's argv.
    expect(c2.args).toContain("--no-session-persistence");
    expect(c2.args).not.toContain("--session-id");
    expect(globalThis.__claudeCliSessions.disabled).toMatch(/transcript not found/);
  });

  it("runs today's path, untouched, with the cache off", async () => {
    process.env.CLI_CLAUDE_SESSION_CACHE = "0";
    try {
      await ask([SYSTEM, { role: "user", content: "q1" }]);
      const [c1] = calls();
      expect(c1.args).toContain("--no-session-persistence");
      expect(c1.args).not.toContain("--session-id");
    } finally {
      process.env.CLI_CLAUDE_SESSION_CACHE = "1";
    }
  });
});
