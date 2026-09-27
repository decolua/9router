import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * A combo [claude-cli, another provider] through the real stack: handleChat, the
 * combo loop, getProviderCredentials, the SQLite connections and model locks, the
 * claude-cli executor with a stand-in `claude`, and a local OpenAI-compatible
 * server as the second step. Only the usage log is mocked, so the test does not
 * write into the operator's ~/.9router.
 *
 * What it pins is what the unit tests could not: that a switched-off claude-cli,
 * and a claude-cli account that has said it is out of quota, are skipped *by the
 * combo*, and that a spent account is not spawned for again.
 */

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  getUsageDb: vi.fn(async () => ({})),
  getUsageStats: vi.fn(async () => ({})),
  getUsageHistory: vi.fn(async () => []),
}));

const originalDataDir = process.env.DATA_DIR;
const saved = {};
let tempDir;
let binDir;
let db;
let handleChat;
let server;
let serverHits = 0;
let cliRow;

const standIn = () => `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const ROOT = ${JSON.stringify(path.join(os.tmpdir(), "9r-combo-e2e-ctl"))};
process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  fs.appendFileSync(path.join(ROOT, "calls.jsonl"), "x\\n");
  let mode = "ok";
  try { mode = fs.readFileSync(path.join(ROOT, "mode.txt"), "utf8").trim(); } catch {}
  const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  if (mode === "limit") {
    say({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: "five_hour" } });
    say({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your limit · resets 3pm" }] } });
    say({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: "You've hit your limit · resets 3pm" });
    return;
  }
  say({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "from-cli" } } });
  say({ type: "result", subtype: "success", is_error: false, num_turns: 1, stop_reason: "end_turn", result: "from-cli", usage: { input_tokens: 1, output_tokens: 1 } });
});
`;

const ctl = path.join(os.tmpdir(), "9r-combo-e2e-ctl");
const spawns = () => (fs.existsSync(path.join(ctl, "calls.jsonl")) ? fs.readFileSync(path.join(ctl, "calls.jsonl"), "utf8").trim().split("\n").length : 0);
const setMode = (m) => fs.writeFileSync(path.join(ctl, "mode.txt"), m);

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-e2e-"));
  fs.mkdirSync(ctl, { recursive: true });
  binDir = path.join(tempDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
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
  process.env.CLI_CLAUDE_SESSION_CACHE = "0";
  process.env.CLI_CLAUDE_CACHE_RELAY = "0";
  process.env.DATA_DIR = tempDir;

  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      serverHits += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: "chatcmpl-fake", object: "chat.completion", created: 1, model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content: "from-fake" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ requireApiKey: false });
  const node = await db.createProviderNode({
    id: "openai-compatible-fake", type: "openai-compatible", name: "Fake", prefix: "fk", apiType: "chat", baseUrl,
  });
  await db.createProviderConnection({
    provider: node.id, authType: "apikey", name: "fake", apiKey: "k", isActive: true, defaultModel: "test-model",
    providerSpecificData: { prefix: "fk", apiType: "chat", baseUrl, nodeName: "Fake" },
  });
  cliRow = await db.createProviderConnection({
    provider: "claude-cli", authType: "none", accessToken: "cli", name: "cli", displayName: "cli", isActive: true,
    providerSpecificData: { configDir: path.join(tempDir, "claude-config"), kind: "isolated" },
  });
  await db.createCombo({ name: "mix", models: ["ccli/claude-cli-haiku", "fk/test-model"], kind: "fallback" });
  ({ handleChat } = await import("@/sse/handlers/chat.js"));
});

afterAll(async () => {
  await new Promise((r) => server?.close(r));
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  // Windows keeps the SQLite file open until the process exits; the temp dir is the OS's to clean.
  for (const dir of [tempDir, ctl]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ } }
});

beforeEach(async () => {
  serverHits = 0;
  fs.rmSync(path.join(ctl, "calls.jsonl"), { force: true });
  setMode("ok");
  const { resetRateLimitWindows } = await import("open-sse/executors/claudeCliRateLimits.js");
  resetRateLimitWindows();
  // Clear any lock a previous scenario left on the account.
  await db.updateProviderConnection(cliRow.id, { isActive: true, testStatus: "active", rateLimitedUntil: null, backoffLevel: 0 });
  const fresh = (await db.getProviderConnections({ provider: "claude-cli" }))[0];
  const clear = Object.fromEntries(Object.keys(fresh).filter((k) => k.startsWith("modelLock_")).map((k) => [k, null]));
  if (Object.keys(clear).length) await db.updateProviderConnection(cliRow.id, clear);
});

async function ask() {
  const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mix", messages: [{ role: "user", content: "hi" }], stream: false }),
  }));
  const text = await response.text();
  let content = null;
  try { content = JSON.parse(text).choices?.[0]?.message?.content; } catch { /* not JSON */ }
  return { status: response.status, content, text };
}

describe("a combo [claude-cli, fake], end to end", () => {
  it("uses claude-cli first when it is on and healthy", async () => {
    const out = await ask();
    expect(out.status).toBe(200);
    expect(out.content).toBe("from-cli");
    expect(spawns()).toBe(1);
    expect(serverHits).toBe(0);
  });

  it("skips claude-cli, spawning nothing, when every account is switched off", async () => {
    await db.updateProviderConnection(cliRow.id, { isActive: false });
    const out = await ask();
    expect(out.status).toBe(200);
    expect(out.content).toBe("from-fake");
    expect(spawns()).toBe(0);
    expect(serverHits).toBe(1);
  });

  it("moves on when the account is out of quota, and does not spawn for it again", async () => {
    setMode("limit");
    const first = await ask();
    expect(first.status).toBe(200);
    expect(first.content).toBe("from-fake");
    expect(spawns()).toBe(1);

    // The model is locked on the account until the reset the CLI gave (capped at
    // 30 minutes) — not the 30 seconds a plain 502 would have cost.
    const locks = async () => {
      const row = (await db.getProviderConnections({ provider: "claude-cli" }))[0];
      return Object.entries(row).filter(([k, v]) => k.startsWith("modelLock_") && v).map(([, v]) => new Date(v).getTime());
    };
    const [until] = await locks();
    expect(until).toBeGreaterThan(Date.now() + 20 * 60 * 1000);

    // The account is spent: the next requests go straight to the second step.
    setMode("ok");
    const second = await ask();
    const third = await ask();
    expect(second.content).toBe("from-fake");
    expect(third.content).toBe("from-fake");
    expect(spawns()).toBe(1);

    // And when that lock lapses (the periodic retry) the account is still not
    // spawned for: it said when it would be back, and that time has not come.
    const row = (await db.getProviderConnections({ provider: "claude-cli" }))[0];
    const clear = Object.fromEntries(Object.keys(row).filter((k) => k.startsWith("modelLock_")).map((k) => [k, null]));
    await db.updateProviderConnection(cliRow.id, { ...clear, rateLimitedUntil: null });
    const afterLapse = await ask();
    expect(afterLapse.content).toBe("from-fake");
    expect(spawns()).toBe(1);
  });

  it("goes back to claude-cli once the block is gone (the periodic retry)", async () => {
    setMode("limit");
    await ask();
    const { resetRateLimitWindows } = await import("open-sse/executors/claudeCliRateLimits.js");
    resetRateLimitWindows(); // the block has lapsed
    const fresh = (await db.getProviderConnections({ provider: "claude-cli" }))[0];
    const clear = Object.fromEntries(Object.keys(fresh).filter((k) => k.startsWith("modelLock_")).map((k) => [k, null]));
    await db.updateProviderConnection(cliRow.id, { ...clear, rateLimitedUntil: null });
    setMode("ok");
    const out = await ask();
    expect(out.content).toBe("from-cli");
  });
});
