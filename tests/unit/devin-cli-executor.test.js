import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import os from "node:os";

// `vi.hoisted` runs before the mocked module is evaluated, so the factory can
// safely reference the mock fn.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: (...args) => spawnMock(...args),
}));

const { default: DevinCliExecutor } = await import("open-sse/executors/devin-cli.js");

// Fake devin ACP subprocess. Mirrors the real CLI's session/new validation:
// it requires `mcpServers` to be an array, otherwise returns -32602 — this is
// the exact error the dashboard "test" button hit ("Invalid params").
function makeFakeChild() {
  const child = new EventEmitter();
  child.writes = [];
  child.stdin = new EventEmitter();
  child.stdin.destroyed = false;
  child.stdin.write = (data) => {
    child.writes.push(String(data));
    try {
      const msg = JSON.parse(String(data).trim());
      handle(msg);
    } catch {
      /* ignore */
    }
    return true;
  };
  child.stdin.end = () => {
    child.stdin.destroyed = true;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };

  const send = (obj) =>
    child.stdout.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));

  function handle(msg) {
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
    } else if (msg.method === "session/new") {
      // Mirror devin 3000.2.x: `mcpServers` is a required sequence.
      if (Array.isArray(msg.params && msg.params.mcpServers)) {
        send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "fake-session" } });
      } else if (!msg.params || msg.params.mcpServers === undefined) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "Invalid params", data: { error: "missing field `mcpServers`" } },
        });
      } else {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "Invalid params", data: { error: "invalid type: map, expected a sequence" } },
        });
      }
    } else if (msg.method === "session/prompt") {
      // devin 3000.2.x requires `prompt` (a sequence), not `content`.
      if (Array.isArray(msg.params && msg.params.prompt)) {
        // Agent requests permission to run a tool before replying.
        send({
          jsonrpc: "2.0",
          id: 777,
          method: "session/request_permission",
          params: {
            sessionId: "fake-session",
            options: [
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-once", name: "Reject", kind: "reject_once" },
            ],
          },
        });
        // New ACP shape: streaming via session/update with params.update.sessionUpdate.
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "fake-session", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "(thinking)" } } },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "fake-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello world" } } },
        });
        // Stop signal: _cognition.ai/agent_stopped notification.
        send({ jsonrpc: "2.0", method: "_cognition.ai/agent_stopped", params: { cause: "complete" } });
      } else {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32602, message: "Invalid params", data: { error: "missing field `prompt`" } },
        });
      }
    }
  }

  return child;
}

async function runExecute(credentials = {}) {
  const child = makeFakeChild();
  spawnMock.mockImplementation((bin, args, opts) => {
    child.bin = bin;
    child.args = args;
    child.opts = opts;
    return child;
  });
  const exec = new DevinCliExecutor();
  const { response } = await exec.execute({
    model: "swe-1.6-fast",
    body: { messages: [{ role: "user", content: "hi" }] },
    credentials,
    log: { info() {}, debug() {} },
  });
  const reader = response.body.getReader();
  let acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += new TextDecoder().decode(value);
  }
  return { acc, child };
}

describe("DevinCliExecutor ACP session/new", () => {
  it("sends session/new with mcpServers as an array", async () => {
    const { child } = await runExecute();
    const writes = child.writes.map((w) => JSON.parse(w.trim()));
    const newMsg = writes.find((m) => m.method === "session/new");
    expect(newMsg).toBeTruthy();
    expect(Array.isArray(newMsg.params.mcpServers)).toBe(true);
  });

  it("defaults session/new cwd to os.tmpdir when request has no workspace cwd", async () => {
    const { child } = await runExecute();
    const writes = child.writes.map((w) => JSON.parse(w.trim()));
    const newMsg = writes.find((m) => m.method === "session/new");
    expect(newMsg.params.cwd).toBe(os.tmpdir());
  });

  it("uses client <cwd> env context for session/new and spawn", async () => {
    const child = makeFakeChild();
    spawnMock.mockImplementation((bin, args, opts) => {
      child.args = args;
      child.opts = opts;
      return child;
    });
    const workspace = os.tmpdir(); // known existing absolute dir
    const exec = new DevinCliExecutor();
    const { response } = await exec.execute({
      model: "swe-1.6-fast",
      body: {
        messages: [
          {
            role: "user",
            content: `<environment_context>\n  <cwd>${workspace}</cwd>\n</environment_context>\nhi`,
          },
        ],
      },
      credentials: {},
      log: { info() {}, debug() {} },
    });
    const reader = response.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(child.opts.cwd).toBe(workspace);
    const writes = child.writes.map((w) => JSON.parse(w.trim()));
    const newMsg = writes.find((m) => m.method === "session/new");
    expect(newMsg.params.cwd).toBe(workspace);
  });

  it("sends session/prompt with prompt (not content) as an array", async () => {
    const { child } = await runExecute();
    const writes = child.writes.map((w) => JSON.parse(w.trim()));
    const promptMsg = writes.find((m) => m.method === "session/prompt");
    expect(promptMsg).toBeTruthy();
    expect(Array.isArray(promptMsg.params.prompt)).toBe(true);
    expect(promptMsg.params.content).toBeUndefined();
  });

  it("completes the prompt without a -32602 Invalid params error", async () => {
    const { acc } = await runExecute();
    expect(acc).not.toContain("-32602");
    expect(acc).not.toContain("Invalid params");
    expect(acc.toLowerCase()).toContain("hello world");
  });

  it("emits agent_message_chunk content and skips agent_thought_chunk", async () => {
    // devin 3000.2.x streams via params.update.sessionUpdate.
    const { acc } = await runExecute();
    // Reply text is delivered, finish chunk present, thinking is not surfaced.
    expect(acc.toLowerCase()).toContain("hello world");
    expect(acc).toContain("finish_reason");
    expect(acc.toLowerCase()).not.toContain("(thinking)");
    expect(acc).toContain("[DONE]");
  });

  it("spawns the default agent (with built-in tools) by default", async () => {
    const { child } = await runExecute();
    expect(child.args).toEqual(["acp"]);
  });

  it("seeds MCP with tool_result from prior client round-trip", async () => {
    const fs = await import("node:fs");
    const child = makeFakeChild();
    let capturedCfg = null;
    let capturedPrompt = null;
    spawnMock.mockImplementation((bin, args, opts) => {
      child.args = args;
      child.opts = opts;
      // Capture config at spawn time (finish() cleans the temp dir).
      if (opts?.env?.XDG_CONFIG_HOME) {
        capturedCfg = JSON.parse(
          fs.readFileSync(opts.env.XDG_CONFIG_HOME + "/devin/config.json", "utf8")
        );
      }
      return child;
    });
    const origWrite = child.stdin.write;
    child.stdin.write = (data) => {
      const s = String(data);
      try {
        const msg = JSON.parse(s.trim());
        if (msg.method === "session/prompt") {
          capturedPrompt = msg.params.prompt[0].text;
        }
      } catch {
        /* ignore */
      }
      return origWrite.call(child.stdin, data);
    };
    const exec = new DevinCliExecutor();
    const { response } = await exec.execute({
      model: "swe-1.6-fast",
      body: {
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Paris"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "28C sunny" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          },
        ],
      },
      credentials: {},
      log: { info() {}, debug() {} },
    });
    const reader = response.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(capturedCfg).toBeTruthy();
    const results = JSON.parse(capturedCfg.mcpServers.clientTools.env.DEVIN_MCP_RESULTS);
    expect(results.mcp_get_weather).toBe("28C sunny");
    expect(capturedPrompt).toContain("get_weather");
    expect(capturedPrompt).toContain("28C sunny");
  });

  it("bridges a client-tool MCP call to an OpenAI tool_use", async () => {
    // Custom fake: on session/prompt, report devin calling our exposed MCP tool.
    const child = new EventEmitter();
    child.writes = [];
    child.stdin = new EventEmitter();
    child.stdin.destroyed = false;
    child.stdin.write = (data) => { child.writes.push(String(data)); handle(JSON.parse(String(data).trim())); return true; };
    child.stdin.end = () => { child.stdin.destroyed = true; };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.args = ["acp"];
    child.opts = { env: {} };
    spawnMock.mockReturnValue(child);
    const send = (o) => child.stdout.emit("data", Buffer.from(JSON.stringify(o) + "\n"));
    function handle(msg) {
      if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
      else if (msg.method === "session/new") send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } });
      else if (msg.method === "session/prompt") {
        // Mirror real ACP: title on first event, rawInput on a later update.
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "s1", update: { sessionUpdate: "tool_call", toolCallId: "call_abc", title: "Calling mcp_get_weather from clientTools" } },
        });
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "s1", update: { sessionUpdate: "tool_call_update", toolCallId: "call_abc", rawInput: { city: "Paris" } } },
        });
      }
    }

    const exec = new DevinCliExecutor();
    const { response } = await exec.execute({
      model: "swe-1.6-fast",
      body: {
        messages: [{ role: "user", content: "weather?" }],
        tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
      },
      credentials: {},
      log: { info() {}, debug() {} },
    });
    const reader = response.body.getReader();
    let acc = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += new TextDecoder().decode(value);
      if (acc.includes("[DONE]")) break;
    }
    const tc = JSON.parse(acc.match(/"tool_calls":\[(\{.*?\})\]/)?.[1] ?? "{}");
    expect(tc.function.name).toBe("get_weather"); // mcp_ prefix stripped, MCP-real untouched
    expect(tc.id).toBe("call_abc");
    expect(JSON.parse(tc.function.arguments).city).toBe("Paris");
    expect(acc).toContain('"finish_reason":"tool_calls"');
    expect(acc).toContain("[DONE]");
  });

  it("overrides the agent type via CLI_DEVIN_AGENT_TYPE", async () => {
    process.env.CLI_DEVIN_AGENT_TYPE = "summarizer";
    try {
      const { child } = await runExecute();
      expect(child.args).toEqual(["acp", "--agent-type", "summarizer"]);
    } finally {
      delete process.env.CLI_DEVIN_AGENT_TYPE;
    }
  });

  it("sets DEVIN_PERMISSION_MODE=bypass so tool calls don't hang on permission prompts", async () => {
    const { child } = await runExecute();
    expect(child.opts.env.DEVIN_PERMISSION_MODE).toBe("bypass");
  });

  it("does not inject WINDSURF_API_KEY — devin-cli uses stored CLI creds (devin auth login)", async () => {
    // Provider is noAuth; devin must fall back to ~/.local/share/devin/credentials.toml.
    // Injecting a bogus WINDSURF_API_KEY makes devin reject stored creds → -32000.
    const { child } = await runExecute({ accessToken: "bogus-token", apiKey: "bogus-key" });
    expect(child.opts.env.WINDSURF_API_KEY).toBeUndefined();
  });

  it("respects an explicit DEVIN_PERMISSION_MODE override", async () => {
    process.env.DEVIN_PERMISSION_MODE = "accept-edits";
    try {
      const { child } = await runExecute();
      expect(child.opts.env.DEVIN_PERMISSION_MODE).toBe("accept-edits");
    } finally {
      delete process.env.DEVIN_PERMISSION_MODE;
    }
  });

  it("auto-approves session/request_permission with the first allow option", async () => {
    const { child } = await runExecute();
    const writes = child.writes.map((w) => JSON.parse(w.trim()));
    const resp = writes.find((m) => m.id === 777 && m.result);
    expect(resp).toBeTruthy();
    expect(resp.result.outcome.outcome).toBe("selected");
    expect(resp.result.outcome.optionId).toBe("allow-once");
  });

  it("sets XDG_CONFIG_HOME when DEVIN_MCP_SERVERS is provided", async () => {
    process.env.DEVIN_MCP_SERVERS = JSON.stringify({
      echo: { command: "/usr/bin/node", args: ["/srv/echo.js"] },
    });
    try {
      const { child } = await runExecute();
      expect(child.opts.env.XDG_CONFIG_HOME).toBeTruthy();
      // devin reads $XDG_CONFIG_HOME/devin/config.json (E2E verifies content).
    } finally {
      delete process.env.DEVIN_MCP_SERVERS;
    }
  });

  it("does not set XDG_CONFIG_HOME when DEVIN_MCP_SERVERS is absent", async () => {
    // The executor inherits the parent env (`{...process.env}`) so CI runners
    // with XDG_CONFIG_HOME pre-set would leak it into the child env. Make the
    // assertion hermetic by clearing the ambient var first.
    const hadXdg = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      const { child } = await runExecute();
      expect(child.opts.env.XDG_CONFIG_HOME).toBeUndefined();
    } finally {
      if (hadXdg) process.env.XDG_CONFIG_HOME = hadXdg;
    }
  });

  it("exposes body.tools as an MCP server (sets XDG_CONFIG_HOME + writes script)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const child = makeFakeChild();
    spawnMock.mockImplementation((bin, args, opts) => {
      child.args = args;
      child.opts = opts;
      return child;
    });
    const exec = new DevinCliExecutor();
    const { response } = await exec.execute({
      model: "swe-1.6-fast",
      body: {
        messages: [{ role: "user", content: "weather?" }],
        tools: [
          { type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object", properties: { city: { type: "string" } } } } },
        ],
      },
      credentials: {},
      log: { info() {}, debug() {} },
    });
    const reader = response.body.getReader();
    await reader.read();
    // XDG_CONFIG_HOME set so devin loads the generated config.
    expect(child.opts.env.XDG_CONFIG_HOME).toBeTruthy();
    // Static MCP bridge script written to disk.
    const scriptPath = path.join(os.tmpdir(), "9router-devin-client-tools.mjs");
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.readFileSync(scriptPath, "utf8")).toContain("clientTools");
    expect(fs.readFileSync(scriptPath, "utf8")).toContain("DEVIN_MCP_TOOLS");
  });
});
