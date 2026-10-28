// `9router acp` — protocol handshake, config options, guard, sessions and a
// full in-process prompt turn (fake gateway + real ACP SDK on both sides).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const require = createRequire(import.meta.url);

const { SseParser } = require("../../cli/src/cli/acp/gateway/sse.js");
const { GatewayClient } = require("../../cli/src/cli/acp/gateway/client.js");
const configOptions = require("../../cli/src/cli/acp/configOptions.js");
const { resolveInRoot, PathEscapeError } = require("../../cli/src/cli/acp/tools/guard.js");
const { SessionStore, titleFromPrompt } = require("../../cli/src/cli/acp/sessions.js");
const { redact } = require("../../cli/src/cli/acp/log.js");
const { assertPublicUrl, globToRegExp } = require("../../cli/src/cli/acp/tools/index.js");
const acpCmd = require("../../cli/src/cli/commands/acp.js");

// ── SSE parser ──────────────────────────────────────────────────────────────

describe("SseParser", () => {
  it("splits frames across chunk boundaries and ignores non-data lines", () => {
    const p = new SseParser();
    expect(p.push('event: message\ndata: {"a"')).toEqual([]);
    expect(p.push(':1}\n\n')).toEqual(['{"a":1}']);
    expect(p.push("data: [DONE]\n\n")).toEqual(["[DONE]"]);
  });

  it("flushes an unterminated trailing frame on end()", () => {
    const p = new SseParser();
    expect(p.push("data: tail")).toEqual([]);
    expect(p.end()).toEqual(["tail"]);
  });

  it("keeps commas and spaces inside payloads intact", () => {
    const p = new SseParser();
    const out = p.push('data: {"x":"a, b"}\n\ndata: {"y":2}\n\n');
    expect(out).toEqual(['{"x":"a, b"}', '{"y":2}']);
  });
});

// ── gateway chat client ─────────────────────────────────────────────────────

describe("GatewayClient.chat", () => {
  let server;
  let port;
  let lastBody;
  let lastHeaders;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        lastBody = JSON.parse(body || "{}");
        lastHeaders = req.headers;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const frames = [
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"path":' } }] },
              },
            ],
          },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        ];
        for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  afterEach(() => new Promise((r) => server.close(r)));

  it("streams deltas, accumulates tool calls and reads usage", async () => {
    const gw = new GatewayClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "sk-unit" });
    const deltas = [];
    const res = await gw.chat({
      model: "m/one",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
      onDelta: (t) => deltas.push(t),
    });
    expect(deltas.join("")).toBe("Hello");
    expect(res.content).toBe("Hello");
    expect(res.toolCalls).toEqual([{ id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' }]);
    expect(res.finishReason).toBe("tool_calls");
    expect(res.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(lastBody.stream).toBe(true);
    expect(lastBody.tools).toHaveLength(1);
    expect(lastHeaders.authorization).toBe("Bearer sk-unit");
  });

  it("disables the token saver with an explicit header", async () => {
    const gw = new GatewayClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "sk-unit" });
    await gw.chat({ model: "m", messages: [], tokenSaver: false });
    expect(lastHeaders["x-9router-token-saver"]).toBe("off");
  });

  it("maps HTTP errors to a redacted GatewayError", async () => {
    const failing = http.createServer((req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid key Bearer sk-secret-abcdef123456" }));
    });
    await new Promise((r) => failing.listen(0, "127.0.0.1", r));
    const gw = new GatewayClient({ baseUrl: `http://127.0.0.1:${failing.address().port}`, apiKey: "sk-unit" });
    await expect(gw.chat({ model: "m", messages: [] })).rejects.toThrow(/401/);
    await new Promise((r) => failing.close(r));
  });
});

// ── configOptions (model picker) ────────────────────────────────────────────

describe("configOptions", () => {
  const models = [
    { id: "kr/claude-sonnet-4.5", owned_by: "kr", capabilities: { tools: true }, context_length: 200000 },
    { id: "free-stack", owned_by: "combo", capabilities: { tools: true }, context_length: 128000 },
    { id: "glm/no-tools", owned_by: "glm", capabilities: { tools: false } },
    { id: "or/web", owned_by: "or", kind: "webSearch" },
    { id: "glm/glm-4.7", owned_by: "glm", capabilities: { tools: true } },
  ];

  it("groups combos first and drops non-agent models", () => {
    const groups = configOptions.buildModelOptions(models);
    expect(groups.map((g) => g.group)).toEqual(["combos", "kr", "glm"]);
    expect(groups[0].options[0].value).toBe("free-stack");
    const all = groups.flatMap((g) => g.options.map((o) => o.value));
    expect(all).not.toContain("glm/no-tools");
    expect(all).not.toContain("or/web");
  });

  it("publishes a model select plus a token-saver toggle", () => {
    const opts = configOptions.buildConfigOptions({ models, currentValue: "free-stack", booleanCapable: true });
    const model = opts.find((o) => o.id === "model");
    expect(model.category).toBe("model");
    expect(model.type).toBe("select");
    expect(model.currentValue).toBe("free-stack");
    expect(opts.find((o) => o.id === "_token_saver").type).toBe("boolean");

    const selectOnly = configOptions.buildConfigOptions({ models, booleanCapable: false });
    expect(selectOnly.find((o) => o.id === "_token_saver").type).toBe("select");
  });

  it("picks a sane default model", () => {
    expect(configOptions.defaultModel(models)).toBe("free-stack");
    expect(configOptions.defaultModel(models, "glm/glm-4.7")).toBe("glm/glm-4.7");
    expect(configOptions.defaultModel([], undefined)).toBeNull();
  });

  it("applies client-side changes to the full option list", () => {
    const opts = configOptions.buildConfigOptions({ models, booleanCapable: true });
    configOptions.applyConfigValue(opts, "model", "kr/claude-sonnet-4.5");
    configOptions.applyConfigValue(opts, "_token_saver", false);
    expect(opts.find((o) => o.id === "model").currentValue).toBe("kr/claude-sonnet-4.5");
    expect(opts.find((o) => o.id === "_token_saver").currentValue).toBe(false);
  });
});

// ── path guard / tool safety ────────────────────────────────────────────────

describe("path guard", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "9r-guard-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("allows relative paths inside the workspace", () => {
    expect(resolveInRoot(root, "a/b.txt")).toBe(path.join(root, "a", "b.txt"));
    expect(resolveInRoot(root, path.join(root, "c.txt"))).toBe(path.join(root, "c.txt"));
  });

  it("rejects traversal, absolute escapes and empty paths", () => {
    expect(() => resolveInRoot(root, "../outside.txt")).toThrow(PathEscapeError);
    expect(() => resolveInRoot(root, "/etc/passwd")).toThrow(PathEscapeError);
    expect(() => resolveInRoot(root, "a/../../x")).toThrow(PathEscapeError);
    expect(() => resolveInRoot(root, "")).toThrow(/required/i);
  });

  it("rejects symlinks pointing outside the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "9r-out-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "s3cret");
    fs.symlinkSync(outside, path.join(root, "link"));
    expect(() => resolveInRoot(root, "link/secret.txt")).toThrow(PathEscapeError);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("blocks SSRF targets for web_fetch", () => {
    expect(() => assertPublicUrl("http://localhost/admin")).toThrow(/local\/private/);
    expect(() => assertPublicUrl("http://127.0.0.1:20128/api/keys")).toThrow(/local\/private/);
    expect(() => assertPublicUrl("http://192.168.1.1/")).toThrow(/local\/private/);
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow(/http/);
    expect(assertPublicUrl("https://example.com/x").hostname).toBe("example.com");
  });

  it("translates globs to anchored regexes", () => {
    expect(globToRegExp("src/**/*.test.js").test("src/a/b/c.test.js")).toBe(true);
    expect(globToRegExp("src/**/*.test.js").test("other/x.test.js")).toBe(false);
    expect(globToRegExp("*.md").test("README.md")).toBe(true);
    expect(globToRegExp("*.md").test("docs/README.md")).toBe(false);
  });
});

// ── sessions ────────────────────────────────────────────────────────────────

describe("SessionStore", () => {
  let file;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "9r-sess-")), "sessions.json");
  });
  afterEach(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  it("creates, lists, persists and deletes sessions", () => {
    const store = new SessionStore({ file });
    const s = store.create({ cwd: "/tmp" });
    expect(s.id).toMatch(/^sess_[0-9a-f]{24}$/);
    store.touch(s, { title: "Fix bug" });
    expect(store.list()[0]).toMatchObject({ sessionId: s.id, title: "Fix bug", cwd: "/tmp" });

    const reloaded = new SessionStore({ file });
    expect(reloaded.ensure(s.id)?.title).toBe("Fix bug");
    expect(reloaded.delete(s.id)).toBe(true);
    expect(new SessionStore({ file }).ensure(s.id)).toBeNull();
  });

  it("caps stored sessions and trims old messages keeping the system prompt", () => {
    const store = new SessionStore({ file });
    const s = store.create({ cwd: "/tmp" });
    s.messages = [{ role: "system", content: "sys" }, ...Array.from({ length: 500 }, (_, i) => ({ role: "user", content: `m${i}` }))];
    store.touch(s);
    expect(s.messages[0].role).toBe("system");
    expect(s.messages.length).toBeLessThanOrEqual(400);
  });

  it("derives a title from the first prompt line", () => {
    expect(titleFromPrompt([{ type: "text", text: "  Fix the login flow\nmore" }])).toBe("Fix the login flow");
    expect(titleFromPrompt([{ type: "text", text: "x".repeat(200) }])).toHaveLength(60);
  });
});

// ── log redaction ───────────────────────────────────────────────────────────

describe("log redaction", () => {
  it("never leaves a bearer token or key in a log line", () => {
    expect(redact("Authorization: Bearer sk-abcdefghijklmnop")).not.toContain("sk-abcdefghijklmnop");
    expect(redact("Bearer abc.def-ghi")).toBe("Bearer [redacted]");
    expect(redact("GET /v1?api_key=supersecret&x=1")).not.toContain("supersecret");
    expect(redact('{"apiKey":"sk-1234567890abcdef"}')).not.toContain("sk-1234567890abcdef");
  });
});

describe("acp arg parsing", () => {
  it("reads url/key/model/log/login", () => {
    const o = acpCmd.__test__.parseArgs(["--url", "http://h:1", "--api-key", "k", "--model", "m", "--log", "/tmp/l", "--login"]);
    expect(o).toMatchObject({ url: "http://h:1", apiKey: "k", model: "m", log: "/tmp/l", login: true });
  });
  it("rejects unknown flags and missing values", () => {
    expect(() => acpCmd.__test__.parseArgs(["--nope"])).toThrow(/Unknown option/);
    expect(() => acpCmd.__test__.parseArgs(["--url"])).toThrow(/Missing value/);
  });
});

// ── MCP stdio bridge ────────────────────────────────────────────────────────

describe("MCP stdio client", () => {
  const { startMcpServers, stopMcpServers } = require("../../cli/src/cli/acp/mcp.js");
  let dir;
  let script;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-mcp-"));
    script = path.join(dir, "server.mjs");
    fs.writeFileSync(
      script,
      `import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") send({ id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  else if (msg.method === "tools/list") send({ id: msg.id, result: { tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { readOnlyHint: true } }] } });
  else if (msg.method === "tools/call") send({ id: msg.id, result: { content: [{ type: "text", text: "echo:" + (msg.params.arguments?.text || "") }] } });
  else if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: "nope" } });
});
function send(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }
`
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("spawns, initializes, lists tools and calls them", async () => {
    const { clients, extraTools } = await startMcpServers(
      [{ name: "fake", command: process.execPath, args: [script], env: {} }],
      { cwd: dir }
    );
    try {
      expect(clients).toHaveLength(1);
      expect(extraTools.map((t) => t.name)).toEqual(["mcp__fake__echo"]);
      const tool = extraTools[0];
      expect(tool.needsPermission).toBe(false); // readOnlyHint
      const res = await tool.run({ args: { text: "hi" }, ctx: { signal: undefined } });
      expect(res.text).toBe("echo:hi");
    } finally {
      stopMcpServers(clients);
    }
  }, 15000);

  it("keeps failing servers out of the tool list instead of crashing", async () => {
    const { clients, extraTools } = await startMcpServers(
      [{ name: "broken", command: process.execPath, args: [path.join(dir, "missing.mjs")], env: {} }],
      { cwd: dir }
    );
    expect(clients).toHaveLength(0);
    expect(extraTools).toHaveLength(0);
    stopMcpServers(clients);
  }, 15000);
});
