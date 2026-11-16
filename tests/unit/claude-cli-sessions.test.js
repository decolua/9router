import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeConversation,
  splitQueryFrame,
  sessionCacheKey,
  conversationKey,
  createAnswerRecorder,
  createSessionRegistry,
  sessionConfigDir,
  sessionFileExists,
  sessionProjectDir,
  sessionCacheEnabled,
  CLAUDE_CLI_SESSION_DIR_MARK,
} from "open-sse/executors/claudeCliSessions.js";
import { buildClaudeCliArgs } from "open-sse/executors/claude-cli.js";
import { buildReplayFrames, transcriptSeed, transcriptRecords } from "open-sse/executors/claudeCliReplay.js";

/**
 * The session cache decides one thing: whether a request continues a session
 * this process started. A key that differs when nothing the model sees has
 * changed is a cache that never hits; a key that matches when something has
 * changed resumes the wrong conversation. These pin both directions.
 */

const base = { accountKey: "tok:abc", model: "claude-cli-haiku", system: "be brief", manifest: [] };
const key = (messages, extra = {}) => sessionCacheKey({ ...base, ...extra, messages });

const call = (id, args) => ({ id, type: "function", function: { name: "get_weather", arguments: args } });

describe("the conversation a key is made of", () => {
  it("ignores what a client drops or rewrites on the way back", () => {
    const sent = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", reasoning_content: "thinking about greeting" },
    ];
    const echoed = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: "hello  \n", name: "bot" },
    ];
    expect(key(sent)).toBe(key(echoed));
  });

  it("compares tool-call arguments as values, not as the SDK re-serialised them", () => {
    const streamed = [{ role: "user", content: "weather?" }, { role: "assistant", content: null, tool_calls: [call("call_1", '{"city":"Seoul","unit":"c"}')] }];
    const echoed = [{ role: "user", content: "weather?" }, { role: "assistant", content: "", tool_calls: [call("call_1", '{ "unit": "c",  "city": "Seoul" }')] }];
    expect(key(streamed)).toBe(key(echoed));
  });

  it("differs when a tool call id differs", () => {
    const a = [{ role: "user", content: "w" }, { role: "assistant", tool_calls: [call("call_1", "{}")] }];
    const b = [{ role: "user", content: "w" }, { role: "assistant", tool_calls: [call("call_2", "{}")] }];
    expect(key(a)).not.toBe(key(b));
  });

  it("differs by account, model, system prompt and tools", () => {
    const m = [{ role: "user", content: "hi" }];
    expect(key(m)).not.toBe(key(m, { accountKey: "tok:other" }));
    expect(key(m)).not.toBe(key(m, { model: "claude-cli-sonnet" }));
    expect(key(m)).not.toBe(key(m, { system: "be long" }));
    expect(key(m)).not.toBe(key(m, { manifest: [{ name: "x" }] }));
  });

  it("does not depend on the order tools were listed in", () => {
    const m = [{ role: "user", content: "hi" }];
    expect(key(m, { manifest: [{ name: "a" }, { name: "b" }] })).toBe(key(m, { manifest: [{ name: "b" }, { name: "a" }] }));
  });

  it("is computed on the body the executor receives — after the RTK hook has compressed tool results, so reordering hooks would break continuation", () => {
    // The executor keys on `body.messages` as handed to it. Today that is the
    // post-RTK body on both turns, so the compressed tool result is what is
    // remembered and what comes back. A hook that ran RTK after the executor
    // on one turn and before it on the next would produce two keys for one
    // conversation; this pins that the key is a pure function of its input.
    const compressed = [{ role: "user", content: "w" }, { role: "assistant", tool_calls: [call("c1", "{}")] }, { role: "tool", tool_call_id: "c1", content: "[compressed]" }, { role: "assistant", content: "ok" }];
    const raw = [{ role: "user", content: "w" }, { role: "assistant", tool_calls: [call("c1", "{}")] }, { role: "tool", tool_call_id: "c1", content: "the whole original output" }, { role: "assistant", content: "ok" }];
    expect(key(compressed)).toBe(key(compressed));
    expect(key(compressed)).not.toBe(key(raw));
  });

  it("leaves system messages to the system field", () => {
    expect(normalizeConversation([{ role: "system", content: "x" }, { role: "user", content: "hi" }]))
      .toEqual([{ r: "user", text: "hi" }]);
  });

  it("hashes images instead of carrying them", () => {
    const [entry] = normalizeConversation([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }]);
    expect(entry.images[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("AAAA");
  });
});

describe("splitQueryFrame", () => {
  it("takes the newest user turn", () => {
    const m = [{ role: "system", content: "s" }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }];
    const { history, query } = splitQueryFrame(m);
    expect(history.map((x) => x.content)).toEqual(["a", "b"]);
    expect(query.map((x) => x.content)).toEqual(["c"]);
  });

  it("takes every result of a parallel tool round as one turn", () => {
    const m = [
      { role: "user", content: "w" },
      { role: "assistant", tool_calls: [call("c1", "{}"), call("c2", "{}"), call("c3", "{}")] },
      { role: "tool", tool_call_id: "c1", content: "1" },
      { role: "tool", tool_call_id: "c2", content: "2" },
      { role: "tool", tool_call_id: "c3", content: "3" },
    ];
    const { history, query } = splitQueryFrame(m);
    expect(history).toHaveLength(2);
    expect(query.map((x) => x.tool_call_id)).toEqual(["c1", "c2", "c3"]);
  });

  it("has nothing to answer after an assistant turn", () => {
    expect(splitQueryFrame([{ role: "user", content: "a" }, { role: "assistant", content: "b" }])).toBeNull();
  });
});

describe("one turn's remember key is the next turn's lookup key", () => {
  it("for a follow-up question", () => {
    const turn1 = [{ role: "user", content: "q1" }];
    const answer = { role: "assistant", content: "a1" };
    const remembered = key([...turn1, answer]);
    const turn2 = [...turn1, { role: "assistant", content: "a1" }, { role: "user", content: "q2" }];
    expect(key(splitQueryFrame(turn2).history)).toBe(remembered);
  });

  it("for tool results answering a proposed call", () => {
    const recorder = createAnswerRecorder();
    // What the client was streamed: a call in pieces.
    const chunk = (delta) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
    recorder.frame(chunk({ role: "assistant" }));
    recorder.frame(chunk({ tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "get_weather", arguments: "" } }] }));
    recorder.frame(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }));
    recorder.frame(chunk({ tool_calls: [{ index: 0, function: { arguments: '"Seoul"}' } }] }));
    const turn1 = [{ role: "user", content: "weather?" }];
    const remembered = key([...turn1, recorder.message()]);
    const turn2 = [
      ...turn1,
      { role: "assistant", content: null, tool_calls: [call("call_9", '{"city": "Seoul"}')] },
      { role: "tool", tool_call_id: "call_9", content: "sunny" },
    ];
    expect(key(splitQueryFrame(turn2).history)).toBe(remembered);
  });

  it("and the conversation key ignores the system prompt", () => {
    const m = [{ role: "user", content: "hi" }];
    expect(conversationKey({ ...base, messages: m })).toBe(conversationKey({ ...base, system: "other", messages: m }));
  });
});

const U = (n) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

/** A session laid out the way the CLI lays it out, under a fake config dir. */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-sessions-test-"));
  const configDir = path.join(root, "config");
  const spawnRoot = path.join(root, `${CLAUDE_CLI_SESSION_DIR_MARK}Ab12Cd`);
  // The operator's own project whose name merely contains the mark.
  const other = path.join(configDir, "projects", "-Users-me-code-9router-claude-proxy");
  fs.mkdirSync(other, { recursive: true });
  const session = (id, { transcript = true } = {}) => {
    const cwd = path.join(spawnRoot, "sessions", id);
    fs.mkdirSync(cwd, { recursive: true });
    const project = sessionProjectDir(configDir, cwd);
    fs.mkdirSync(project, { recursive: true });
    if (transcript) fs.writeFileSync(path.join(project, `${id}.jsonl`), "{}");
    return { sessionId: id, cwd, configDir, project };
  };
  return { root, configDir, other, session };
}

describe("the registry", () => {
  it("hands a session to one request at a time, and only once per key", () => {
    const box = sandbox();
    const registry = createSessionRegistry();
    const entry = registry.begin(box.session(U(1)));
    registry.remember("k1", entry);
    const taken = registry.take("k1");
    expect(taken?.sessionId).toBe(U(1));
    // Taken: the session moved on, and a regeneration of the same turn must
    // not resume past it.
    expect(registry.take("k1")).toBeNull();
    registry.remember("k2", taken);
    expect(registry.take("k2")?.sessionId).toBe(U(1));
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("will not resume a session whose file is gone", () => {
    const box = sandbox();
    const registry = createSessionRegistry();
    const entry = registry.begin(box.session(U(2), { transcript: false }));
    registry.remember("k", entry);
    expect(registry.take("k")).toBeNull();
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("will not resume a session another request is running", () => {
    const box = sandbox();
    const registry = createSessionRegistry();
    const entry = box.session(U(3));
    registry.remember("k", entry);
    registry.begin({ sessionId: U(3) });
    expect(registry.take("k")).toBeNull();
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("expires entries and deletes what they left on disk", () => {
    const box = sandbox();
    let t = 0;
    const registry = createSessionRegistry({ ttlMs: 100, now: () => t });
    const entry = box.session(U(4));
    registry.remember("k", entry);
    t = 200;
    expect(registry.take("k")).toBeNull();
    registry.sweep();
    expect(fs.existsSync(path.join(entry.project, `${U(4)}.jsonl`))).toBe(false);
    expect(fs.existsSync(entry.cwd)).toBe(false);
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("clears a previous process's sessions, and never the operator's own", () => {
    const box = sandbox();
    const registry = createSessionRegistry({ ttlMs: 100 });
    const stale = box.session(U(5));
    const fresh = box.session(U(6));
    const staleFile = path.join(stale.project, `${U(5)}.jsonl`);
    const freshFile = path.join(fresh.project, `${U(6)}.jsonl`);
    // An interactive transcript in a directory whose name contains the mark.
    const mine = path.join(box.other, `${U(7)}.jsonl`);
    fs.writeFileSync(mine, "{}");
    const old = new Date(Date.now() - 10000);
    for (const f of [staleFile, mine]) fs.utimesSync(f, old, old);
    expect(registry.sweepOrphans(box.configDir)).toBe(1);
    expect(fs.existsSync(staleFile)).toBe(false);
    // Younger than the TTL: another 9Router sharing the directory may be using it.
    expect(fs.existsSync(freshFile)).toBe(true);
    // Not this provider's: never touched, whatever its name contains.
    expect(fs.existsSync(mine)).toBe(true);
    // Once per directory per process.
    expect(registry.sweepOrphans(box.configDir)).toBe(0);
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("never deletes outside a session's own directory, even for an entry that is not ours", () => {
    const box = sandbox();
    const mine = path.join(box.other, `${U(8)}.jsonl`);
    fs.writeFileSync(mine, "{}");
    const registry = createSessionRegistry();
    // A cwd that encodes to the operator's directory.
    registry.discard({ sessionId: U(8), configDir: box.configDir, cwd: "/Users/me/code/9router-claude-proxy/nope", projectDir: box.other });
    expect(fs.existsSync(mine)).toBe(true);
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("deletes the transcript a same-key remember replaces", () => {
    // Two requests ran the same conversation at once; both finish with the
    // same continuation key. Only one session can continue it, and the other
    // must not stay on disk with nothing left to expire it.
    const box = sandbox();
    const registry = createSessionRegistry();
    const first = box.session(U(14));
    const second = box.session(U(15));
    registry.remember("k", first);
    registry.remember("k", second);
    expect(fs.existsSync(path.join(first.project, `${U(14)}.jsonl`))).toBe(false);
    expect(fs.existsSync(path.join(second.project, `${U(15)}.jsonl`))).toBe(true);
    expect(registry.take("k")?.sessionId).toBe(U(15));
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("looks for orphans again on every sweep, not only the first time", () => {
    const box = sandbox();
    let t = Date.now();
    const registry = createSessionRegistry({ ttlMs: 1000, now: () => t });
    const young = box.session(U(16));
    const file = path.join(young.project, `${U(16)}.jsonl`);
    // First look: too young to be an orphan.
    expect(registry.sweepOrphans(box.configDir)).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
    // Later: past the TTL, and nothing in the registry claims it.
    t += 5000;
    expect(registry.sweep()).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("keeps at most `max` entries, oldest out first", () => {
    const box = sandbox();
    const registry = createSessionRegistry({ max: 2 });
    for (const n of [9, 10, 11]) registry.remember(String(n), box.session(U(n)));
    expect(registry.stats().entries).toBe(2);
    fs.rmSync(box.root, { recursive: true, force: true });
  });

  it("tells a changed system prompt from a different conversation", () => {
    const registry = createSessionRegistry();
    registry.remember("k", { sessionId: "s" }, { conversation: "conv", systemHash: "h1" });
    expect(registry.systemChanged("conv", "h2")).toBe(true);
    expect(registry.systemChanged("conv", "h1")).toBe(false);
    expect(registry.systemChanged("other", "h2")).toBe(false);
  });
});

describe("where sessions live", () => {
  it("follows the same account rule the spawn does", () => {
    const env = { HOME: "/home/u", CLAUDE_CONFIG_DIR: "/host/config" };
    expect(sessionConfigDir({ configDir: "/acct" }, env)).toBe("/acct");
    // A token account runs without CLAUDE_CONFIG_DIR, so in the home default.
    expect(sessionConfigDir({ oauthToken: "sk-ant-oat01-x" }, env)).toBe(path.join("/home/u", ".claude"));
    expect(sessionConfigDir({}, env)).toBe("/host/config");
  });

  it("encodes the cwd the way the CLI names its project directory", () => {
    expect(path.basename(sessionProjectDir("/c", "/private/tmp/9router-claude-Ab12Cd/sessions/x")))
      .toBe("-private-tmp-9router-claude-Ab12Cd-sessions-x");
  });

  it("finds a session file only in the session's own directory", () => {
    const box = sandbox();
    const entry = box.session(U(12));
    expect(sessionFileExists(entry)).toBe(true);
    fs.writeFileSync(path.join(box.other, `${U(13)}.jsonl`), "{}");
    expect(sessionFileExists({ sessionId: U(13), configDir: box.configDir, cwd: "/Users/me/code/9router-claude-proxy" })).toBe(false);
    fs.rmSync(box.root, { recursive: true, force: true });
  });
});

describe("the arguments a session runs with", () => {
  it("is today's argv, byte for byte, when no session is involved", () => {
    const args = buildClaudeCliArgs({ model: "claude-cli-haiku", maxTurns: 1, streamJsonInput: true });
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--resume");
  });

  it("names the session to create, and persists it", () => {
    const args = buildClaudeCliArgs({ model: "claude-cli-haiku", maxTurns: 1, sessionId: "11111111-1111-4111-8111-111111111111" });
    expect(args).not.toContain("--no-session-persistence");
    expect(args[args.indexOf("--session-id") + 1]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("resumes, rather than names, when continuing", () => {
    const args = buildClaudeCliArgs({ model: "claude-cli-haiku", maxTurns: 1, sessionId: "a", resumeId: "b" });
    expect(args[args.indexOf("--resume") + 1]).toBe("b");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--no-session-persistence");
    // The isolation flags do not move.
    for (const flag of ["--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "--tools"]) expect(args).toContain(flag);
    expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
  });

  it("is off unless asked for", () => {
    expect(sessionCacheEnabled({})).toBe(false);
    expect(sessionCacheEnabled({ CLI_CLAUDE_SESSION_CACHE: "1" })).toBe(true);
  });
});

describe("seeding a transcript from the client's history", () => {
  const PREFIX = "mcp__ninerouter__";
  const frames = (messages) => buildReplayFrames(messages, PREFIX).frames;

  it("hands every frame but the newest user turn to the transcript", () => {
    const seed = transcriptSeed(frames([
      { role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "user", content: "q2" },
    ]));
    expect(seed.seed.map((f) => f.type)).toEqual(["user", "assistant"]);
    expect(seed.query.message.content).toEqual([{ type: "text", text: "q2" }]);
  });

  it("seeds a completed tool round that sits inside the history", () => {
    const seed = transcriptSeed(frames([
      { role: "user", content: "weather?" },
      { role: "assistant", content: null, tool_calls: [call("c1", '{"city":"Seoul"}')] },
      { role: "tool", tool_call_id: "c1", content: "sunny" },
      { role: "assistant", content: "It is sunny." },
      { role: "user", content: "and tomorrow?" },
    ]));
    expect(seed.seed.map((f) => f.type)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(seed.seed[1].message.content[0]).toMatchObject({ type: "tool_use", id: "c1", name: `${PREFIX}get_weather` });
    expect(seed.seed[2].message.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "c1" });
  });

  it("refuses when the query is a tool result — the CLI closes the open call itself and drops ours", () => {
    expect(transcriptSeed(frames([
      { role: "user", content: "weather?" },
      { role: "assistant", content: null, tool_calls: [call("c1", "{}")] },
      { role: "tool", tool_call_id: "c1", content: "sunny" },
    ]))).toBeNull();
  });

  it("refuses a single-turn conversation: nothing to seed", () => {
    expect(transcriptSeed(frames([{ role: "user", content: "q1" }]))).toBeNull();
  });

  it("writes records chained by uuid, in order, with only the fields the CLI reads back", () => {
    const seed = transcriptSeed(frames([{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "user", content: "q2" }]));
    const now = Date.parse("2026-09-24T12:00:10.000Z");
    const lines = transcriptRecords(seed.seed, { sessionId: "s", cwd: "/tmp/x", now }).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].parentUuid).toBeNull();
    expect(lines[1].parentUuid).toBe(lines[0].uuid);
    expect(lines.map((l) => l.type)).toEqual(["user", "assistant"]);
    expect(lines.map((l) => l.message.role)).toEqual(["user", "assistant"]);
    expect(lines[0].timestamp < lines[1].timestamp).toBe(true);
    expect(lines[1].timestamp).toBe("2026-09-24T12:00:09.000Z");
    for (const l of lines) {
      expect(Object.keys(l).sort()).toEqual(["cwd", "message", "parentUuid", "sessionId", "timestamp", "type", "uuid"]);
      expect(l.sessionId).toBe("s");
      expect(l.cwd).toBe("/tmp/x");
    }
  });
});
