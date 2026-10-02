// Exercise Codex's actual history reducer and compaction protocol in a temporary
// CODEX_HOME. All inference goes through the caller's disposable fixture bridge.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { mergeCatalog } from "../public/9router-codex.mjs";

export async function checkCodexCompaction(endpoint, manifest) {
  assert.equal(new URL(endpoint).hostname, "127.0.0.1");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "9router-codex-compact-"));
  const codexHome = path.join(directory, "codex");
  await fs.mkdir(codexHome);
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || os.tmpdir(), CODEX_HOME: codexHome, NO_PROXY: "*" };
  const executable = process.env.CHATGPT_QA_CODEX || "codex";
  let child;
  const notifications = [], pending = new Map(), listeners = new Set(), timers = new Set();
  let nextId = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 60000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  const waitFor = (predicate, start = 0) => new Promise((resolve, reject) => {
    let timer;
    const check = () => {
      const match = notifications.slice(start).find(predicate);
      if (match) { clearTimeout(timer); timers.delete(timer); listeners.delete(check); resolve(match); }
    };
    timer = setTimeout(() => { listeners.delete(check); reject(new Error("Timed out waiting for Codex notification")); }, 60000);
    timers.add(timer); listeners.add(check); check();
  });
  const stop = async () => {
    const process = child;
    if (!process || process.exitCode !== null) return;
    process.kill("SIGTERM");
    await new Promise(resolve => {
      const timer = setTimeout(() => { process.kill("SIGKILL"); resolve(); }, 3000);
      process.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  };
  try {
    const { stdout } = await promisify(execFile)(executable, ["debug", "models", "--bundled"], { env, cwd: directory, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const bundled = JSON.parse(stdout);
    await fs.writeFile(path.join(codexHome, "catalog.json"), JSON.stringify(mergeCatalog(Array.isArray(bundled) ? bundled : bundled.models, manifest)));
    const jwt = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const idToken = `${jwt({ alg: "none" })}.${jwt({ exp: Math.floor(Date.now() / 1000) + 86400, email: "fixture@example.invalid", "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account", chatgpt_plan_type: "pro", chatgpt_user_id: "fixture-user" } })}.fixture`;
    await fs.writeFile(path.join(codexHome, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: idToken, access_token: "fixture-native-token", refresh_token: "fixture-refresh", account_id: "fixture-account" }, last_refresh: new Date().toISOString() }));
    await fs.writeFile(path.join(codexHome, "config.toml"), [
      `model = ${JSON.stringify(manifest.models[0].slug)}`,
      'model_provider = "openai"', `openai_base_url = ${JSON.stringify(endpoint)}`,
      `model_catalog_json = ${JSON.stringify(path.join(codexHome, "catalog.json"))}`,
      'cli_auth_credentials_store = "file"', 'approval_policy = "never"',
      'model_auto_compact_token_limit = 1000000',
      '[features]', 'remote_compaction_v2 = true',
      '[analytics]', 'enabled = false',
    ].join("\n") + "\n");
    const launch = async () => {
      child = spawn(executable, ["app-server", "--listen", "stdio://"], { env, cwd: directory, stdio: ["pipe", "pipe", "pipe"] });
      child.stderr.on("data", () => {});
      createInterface({ input: child.stdout }).on("line", line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.id != null && pending.has(message.id)) {
          const handler = pending.get(message.id); pending.delete(message.id);
          if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
          else handler.resolve(message.result);
        } else if (message.method) { notifications.push(message); for (const listener of listeners) listener(); }
      });
      child.on("error", error => { for (const handler of pending.values()) handler.reject(error); pending.clear(); });
      await request("initialize", { clientInfo: { name: "9router_compaction_qa", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } });
      child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    };
    await launch();
    const start = async limit => (await request("thread/start", { model: manifest.models[0].slug, cwd: directory, baseInstructions: "Answer the request. Do not run tools.", config: { model_auto_compact_token_limit: limit } })).thread.id;
    const turn = async (threadId, text) => {
      const cursor = notifications.length;
      const { turn: begun } = await request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }] });
      const done = await waitFor(m => m.method === "turn/completed" && m.params.threadId === threadId && m.params.turn.id === begun.id, cursor);
      assert.equal(done.params.turn.status, "completed", JSON.stringify(done.params.turn.error));
    };
    const threadId = await start(1000000);
    await turn(threadId, "Remember QA_CONTEXT and the work already completed.");
    const compactThread = async threadId => {
      const cursor = notifications.length;
      await request("thread/compact/start", { threadId });
      const compact = await waitFor(m => m.method === "turn/completed" && m.params.threadId === threadId, cursor);
      assert.equal(compact.params.turn.status, "completed", JSON.stringify(compact.params.turn.error));
      assert.ok(notifications.slice(cursor).some(m => m.method === "item/completed" && m.params.item.type === "contextCompaction"));
    };
    await compactThread(threadId);
    await turn(threadId, "Continue after manual compaction.");
    await stop();
    await launch();
    await request("thread/resume", { threadId });
    await turn(threadId, "Continue the saved task after restarting Codex.");
    await compactThread(threadId);
    await turn(threadId, "Continue after repeated compaction.");
    const automatic = await start(100000);
    const cursor = notifications.length;
    await turn(automatic, "AUTO_COMPACT_SEED");
    await turn(automatic, "Continue after automatic compaction.");
    assert.ok(notifications.slice(cursor).some(m => m.method === "item/completed" && m.params.threadId === automatic && m.params.item.type === "contextCompaction"), `Codex must actually perform automatic compaction: ${JSON.stringify(notifications.slice(cursor).filter(m => /tokenUsage|error/.test(m.method)))}`);
    const large = await start(1000000);
    await turn(large, "LARGE_COMPACT_SEED");
    await compactThread(large);
    await turn(large, "Continue after large compaction");
    console.log("PASS: real Codex app-server manual, repeated, automatic and large-history compaction, restart/resume from disk, and subsequent turns in isolated CODEX_HOME.");
  } finally {
    for (const handler of pending.values()) handler.reject(new Error("QA stopped"));
    listeners.clear();
    for (const timer of timers) clearTimeout(timer);
    await stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
