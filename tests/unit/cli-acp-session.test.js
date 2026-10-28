// Full ACP prompt-turn integration: real SDK client ↔ real agent, fake gateway.
// Exercises streaming, tool calls, permissions, diffs, escaping, cancel, and
// session lifecycle — without a network or a real model.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const acp = require("../../cli/node_modules/@agentclientprotocol/sdk/dist/acp.js");
const { createAgentApp } = require("../../cli/src/cli/acp/agent.js");
const { SessionStore } = require("../../cli/src/cli/acp/sessions.js");

const MODEL = { id: "kr/claude-sonnet-4.5", owned_by: "kr", capabilities: { tools: true }, context_length: 200000 };

function fakeGateway(script) {
  const calls = [];
  const opts = [];
  let i = 0;
  return {
    calls,
    opts,
    async models() {
      return [MODEL];
    },
    async chat({ messages, onDelta, signal, tokenSaver }) {
      calls.push(messages.map((m) => ({ ...m })));
      opts.push({ tokenSaver });
      const step = script[Math.min(i, script.length - 1)];
      i++;
      await step.wait?.(signal);
      if (step.delta) onDelta?.(step.delta);
      return {
        content: step.content || "",
        reasoning: "",
        toolCalls: step.toolCalls || [],
        finishReason: step.finishReason || "stop",
        usage: { prompt_tokens: 10, completion_tokens: 3 },
        model: MODEL.id,
      };
    },
    async webFetch() {
      return "page body";
    },
  };
}

/** Drive one connected client run against a fresh agent. */
async function withAgent({ gateway, cwd, clientHandlers = {}, onSession, permission }) {
  const storeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "9r-it-")), "sessions.json");
  const agent = createAgentApp(acp, { opts: {}, version: "test", gatewayFactory: () => gateway, store: new SessionStore({ file: storeFile }) });

  const events = [];
  const permissionCalls = [];
  const clientApp = acp
    .client({ name: "test-client" })
    .onNotification("session/update", (ctx) => events.push(ctx.params.update))
    .onRequest("session/request_permission", async (ctx) => {
      permissionCalls.push(ctx.params);
      if (permission) return permission(ctx.params);
      return { outcome: { outcome: "selected", optionId: "allow-once" } };
    })
    .onRequest("fs/read_text_file", (ctx) => ({ content: fs.readFileSync(ctx.params.path, "utf8") }))
    .onRequest("fs/write_text_file", (ctx) => {
      fs.mkdirSync(path.dirname(ctx.params.path), { recursive: true });
      fs.writeFileSync(ctx.params.path, ctx.params.content, "utf8");
      return {};
    });

  for (const [method, handler] of Object.entries(clientHandlers)) clientApp.onRequest(method, handler);

  agent.connect(clientApp);
  const result = await clientApp.connectWith(agent.app, async (ctx) => onSession({ ctx, events, permissionCalls, agent }));
  agent.shutdown();
  return result;
}

const initialize = (ctx) =>
  ctx.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, session: { configOptions: { boolean: {} } } },
    clientInfo: { name: "test-client", version: "1.0.0" },
  });

const newSession = (ctx, cwd) => ctx.request("session/new", { cwd, mcpServers: [] });

const prompt = (ctx, sessionId, text) =>
  ctx.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });

describe("ACP agent prompt turn", () => {
  let cwd;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "9r-cwd-"));
    fs.writeFileSync(path.join(cwd, "a.txt"), "file-contents");
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it("completes a read-only turn with streamed chunks and a tool call", async () => {
    const gateway = fakeGateway([
      { delta: "Let me read that. ", toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.txt" } }], finishReason: "tool_calls" },
      { content: "The file says file-contents.", finishReason: "stop" },
    ]);

    const out = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx, events, permissionCalls }) => {
        const init = await initialize(ctx);
        expect(init.protocolVersion).toBe(1);
        expect(init.agentCapabilities.loadSession).toBe(true);

        const s = await newSession(ctx, cwd);
        expect(s.sessionId).toMatch(/^sess_/);
        const modelOpt = s.configOptions.find((o) => o.id === "model");
        expect(modelOpt.currentValue).toBe(MODEL.id);
        expect(modelOpt.options[0].options[0].value).toBe(MODEL.id);

        const res = await prompt(ctx, s.sessionId, "read a.txt");
        return { res, events, permissionCalls, sessionId: s.sessionId };
      },
    });

    expect(out.res.stopReason).toBe("end_turn");
    const kinds = out.events.map((e) => e.sessionUpdate);
    expect(kinds).toContain("agent_message_chunk");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_call_update");
    expect(kinds).toContain("usage_update");
    expect(kinds).toContain("session_info_update");

    const toolCall = out.events.find((e) => e.sessionUpdate === "tool_call");
    expect(toolCall.name).toBe("read_file");
    expect(toolCall.kind).toBe("read");
    const done = out.events.filter((e) => e.sessionUpdate === "tool_call_update").at(-1);
    expect(done.status).toBe("completed");
    expect(JSON.stringify(done.content)).toContain("file-contents");
    // read_file must not prompt for permission
    expect(out.permissionCalls).toHaveLength(0);
    // second model call received the tool result
    expect(gateway.calls[1].some((m) => m.role === "tool" && m.content.includes("file-contents"))).toBe(true);
  });

  it("writes a file after permission and reports a diff", async () => {
    const gateway = fakeGateway([
      { toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "new.txt", content: "hello world" } }], finishReason: "tool_calls" },
      { content: "Created it.", finishReason: "stop" },
    ]);

    const out = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx, events, permissionCalls }) => {
        const s = await newSession(ctx, cwd);
        const res = await prompt(ctx, s.sessionId, "create new.txt");
        return { res, events, permissionCalls };
      },
    });

    expect(out.res.stopReason).toBe("end_turn");
    expect(out.permissionCalls).toHaveLength(1);
    expect(out.permissionCalls[0].options.map((o) => o.kind)).toEqual(["allow_once", "reject_once"]);
    expect(fs.readFileSync(path.join(cwd, "new.txt"), "utf8")).toBe("hello world");
    const updates = out.events.filter((e) => e.sessionUpdate === "tool_call_update");
    const diff = updates.flatMap((u) => u.content || []).find((c) => c.type === "diff");
    expect(diff).toBeTruthy();
    expect(diff.newText).toBe("hello world");
    expect(diff.oldText).toBeNull();
  });

  it("does not write when the user rejects the permission", async () => {
    const gateway = fakeGateway([
      { toolCalls: [{ id: "c1", name: "write_file", arguments: { path: "denied.txt", content: "nope" } }], finishReason: "tool_calls" },
      { content: "Understood, skipping.", finishReason: "stop" },
    ]);

    const out = await withAgent({
      gateway,
      cwd,
      permission: () => ({ outcome: { outcome: "selected", optionId: "reject-once" } }),
      onSession: async ({ ctx, events }) => {
        const s = await newSession(ctx, cwd);
        const res = await prompt(ctx, s.sessionId, "create denied.txt");
        return { res, events };
      },
    });

    expect(out.res.stopReason).toBe("end_turn");
    expect(fs.existsSync(path.join(cwd, "denied.txt"))).toBe(false);
    const failed = out.events.find((e) => e.sessionUpdate === "tool_call_update" && e.status === "failed");
    expect(JSON.stringify(failed.content)).toMatch(/declined/i);
    // the model still receives a tool result so it can react
    expect(gateway.calls[1].some((m) => m.role === "tool")).toBe(true);
  });

  it("blocks workspace escapes instead of throwing the turn", async () => {
    const gateway = fakeGateway([
      { toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "../outside.txt" } }], finishReason: "tool_calls" },
      { content: "Ok, staying inside.", finishReason: "stop" },
    ]);

    const out = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx, events }) => {
        const s = await newSession(ctx, cwd);
        const res = await prompt(ctx, s.sessionId, "read outside");
        return { res, events };
      },
    });

    expect(out.res.stopReason).toBe("end_turn");
    const failed = out.events.find((e) => e.sessionUpdate === "tool_call_update" && e.status === "failed");
    expect(JSON.stringify(failed.content)).toMatch(/Blocked/);
  });

  it("surfaces unknown tools as failed tool calls", async () => {
    const gateway = fakeGateway([
      { toolCalls: [{ id: "c1", name: "does_not_exist", arguments: {} }], finishReason: "tool_calls" },
      { content: "Right.", finishReason: "stop" },
    ]);
    const out = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx, events }) => {
        const s = await newSession(ctx, cwd);
        const res = await prompt(ctx, s.sessionId, "x");
        return { res, events };
      },
    });
    expect(out.res.stopReason).toBe("end_turn");
    const failed = out.events.find((e) => e.sessionUpdate === "tool_call_update" && e.status === "failed");
    expect(JSON.stringify(failed.content)).toMatch(/Unknown tool/);
  });

  it("honours session/cancel with stopReason cancelled (never an error)", async () => {
    const gateway = fakeGateway([{ content: "slow", wait: (signal) => new Promise((_, rej) => {
      const t = setTimeout(() => rej(new Error("should have been cancelled")), 3000);
      signal?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("cancelled"); e.cancelled = true; rej(e); }, { once: true });
    }) }]);

    const out = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx }) => {
        const s = await newSession(ctx, cwd);
        const pending = prompt(ctx, s.sessionId, "do something slow");
        setTimeout(() => ctx.notify("session/cancel", { sessionId: s.sessionId }).catch(() => {}), 50);
        return { res: await pending };
      },
    });
    expect(out.res.stopReason).toBe("cancelled");
  });

  it("switches model through session/set_config_option", async () => {
    const gateway = fakeGateway([{ content: "ok", finishReason: "stop" }]);
    await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx }) => {
        const s = await newSession(ctx, cwd);
        const updated = await ctx.request("session/set_config_option", { sessionId: s.sessionId, configId: "model", value: "glm/glm-4.7" });
        expect(updated.configOptions.find((o) => o.id === "model").currentValue).toBe("glm/glm-4.7");
        const res = await ctx.request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: "hi" }] });
        expect(res.stopReason).toBe("end_turn");
        return { res };
      },
    });
    expect(gateway.calls[0][1]?.content).toBeTruthy();
  });

  it("lists, loads and deletes sessions across store instances", async () => {
    const gateway = fakeGateway([{ content: "ok" }]);
    const saved = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx, agent }) => {
        const s = await newSession(ctx, cwd);
        await prompt(ctx, s.sessionId, "remember me");
        const list = await ctx.request("session/list", {});
        expect(list.sessions.some((x) => x.sessionId === s.sessionId)).toBe(true);
        expect(list.sessions[0].cwd).toBe(cwd);
        expect(list.sessions[0].updatedAt).toBeTruthy();

        // cwd filter: a directory no session uses → empty array, never null
        const filtered = await ctx.request("session/list", { cwd: path.join(cwd, "no-session-here") });
        expect(filtered.sessions).toEqual([]);
        const matching = await ctx.request("session/list", { cwd });
        expect(matching.sessions.map((x) => x.sessionId)).toContain(s.sessionId);

        // reload replays history as user/agent chunks
        const loaded = await ctx.request("session/load", { sessionId: s.sessionId, cwd, mcpServers: [] });
        expect(loaded.configOptions.find((o) => o.id === "model")).toBeTruthy();
        expect(agent.sessions.ensure(s.sessionId).messages.some((m) => m.role === "user")).toBe(true);

        await ctx.request("session/delete", { sessionId: s.sessionId });
        expect(agent.sessions.ensure(s.sessionId)).toBeNull();
        return { ok: true };
      },
    });
    expect(saved.ok).toBe(true);
  });

  it("rejects prompts for unknown sessions", async () => {
    const gateway = fakeGateway([{ content: "x" }]);
    await expect(
      withAgent({
        gateway,
        cwd,
        onSession: async ({ ctx }) => {
          await prompt(ctx, "sess_nope", "hi");
          return {};
        },
      })
    ).rejects.toThrow(/Unknown session/);
  });

  it("recovers a session created while the gateway listed no models", async () => {
    const gateway = fakeGateway([{ content: "back online." }]);
    let list = [];
    gateway.models = async () => list;
    const sentModels = [];
    const chat = gateway.chat.bind(gateway);
    gateway.chat = async (args) => {
      sentModels.push(args.model);
      return chat(args);
    };

    const out = await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx }) => {
        const s = await newSession(ctx, cwd);
        expect(s.configOptions.find((o) => o.id === "model")).toBeUndefined();
        list = [MODEL]; // gateway recovered between session/new and the first prompt
        const res = await prompt(ctx, s.sessionId, "hi");
        return { res };
      },
    });

    expect(out.res.stopReason).toBe("end_turn");
    expect(sentModels).toEqual([MODEL.id]);
  });

  it("fails with an actionable error when no model can be recovered", async () => {
    const gateway = fakeGateway([{ content: "x" }]);
    gateway.models = async () => [];
    await expect(
      withAgent({
        gateway,
        cwd,
        onSession: async ({ ctx }) => {
          const s = await newSession(ctx, cwd);
          await prompt(ctx, s.sessionId, "hi");
          return {};
        },
      })
    ).rejects.toThrow(/No model selected/);
    expect(gateway.calls.length).toBe(0);
  });

  it("forwards prompt images to the gateway as image_url blocks", async () => {
    const gateway = fakeGateway([{ content: "I see a pixel." }]);
    await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx }) => {
        const s = await newSession(ctx, cwd);
        await ctx.request("session/prompt", {
          sessionId: s.sessionId,
          prompt: [
            { type: "text", text: "what is this?" },
            { type: "image", mimeType: "image/png", data: "AAAA" },
          ],
        });
        return {};
      },
    });
    const userMsg = gateway.calls[0].find((m) => m.role === "user");
    expect(userMsg.content).toBeInstanceOf(Array);
    expect(userMsg.content.find((b) => b.type === "image_url").image_url.url).toBe("data:image/png;base64,AAAA");
  });

  it("propagates the RTK token-saver toggle from config option to the gateway", async () => {
    const gateway = fakeGateway([{ content: "ok" }]);
    await withAgent({
      gateway,
      cwd,
      onSession: async ({ ctx }) => {
        const s = await newSession(ctx, cwd);
        await ctx.request("session/set_config_option", { sessionId: s.sessionId, configId: "_token_saver", type: "boolean", value: false });
        await prompt(ctx, s.sessionId, "hi");
        return {};
      },
    });
    expect(gateway.opts[0].tokenSaver).toBe(false);
  });

  it("authenticates against stored credentials and logs out", async () => {
    const gateway = fakeGateway([{ content: "ok" }]);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-auth-"));
    vi.stubEnv("DATA_DIR", dataDir);
    vi.stubEnv("NINE_ROUTER_API_KEY", "");
    try {
      await expect(
        withAgent({
          gateway,
          cwd,
          onSession: async ({ ctx }) => {
            await ctx.request("authenticate", { methodId: "9router-login" });
            return {};
          },
        })
      ).rejects.toThrow(/No 9Router API key/);

      const { storeCredentials, resolveCredentials, configFile } = require("../../cli/src/cli/acp/auth.js");
      storeCredentials({ baseUrl: "http://127.0.0.1:1", apiKey: "sk-stored-key-0000" });
      expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600);
      expect(resolveCredentials({}).apiKey).toBe("sk-stored-key-0000");

      await withAgent({
        gateway,
        cwd,
        onSession: async ({ ctx }) => {
          await ctx.request("authenticate", { methodId: "9router-login" });
          await ctx.request("logout", {});
          return {};
        },
      });
      expect(resolveCredentials({}).apiKey).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
