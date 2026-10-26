// Run after `npm run build`: node tests/integration/api-key-production-smoke.mjs
// Exercises the production HTTP stack against a disposable SQLite DB and a
// loopback-only mock provider. No real accounts or external providers are used.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = await mkdtemp(join(tmpdir(), "9router-production-policy-"));
const password = randomBytes(24).toString("hex");
const dispatched = [];
const upstream = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ object: "list", data: [{ id: "model-a" }, { id: "model-b" }] }));
    return;
  }
  if (req.url !== "/v1/chat/completions") { res.statusCode = 404; res.end("{}"); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  dispatched.push(body.model);
  res.end(JSON.stringify({ id: "smoke", object: "chat.completion", model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content: "smoke ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
});
await new Promise((done) => upstream.listen(0, "127.0.0.1", done));
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root, env: { ...process.env, DATA_DIR: dataDir, INITIAL_PASSWORD: password,
    JWT_SECRET: randomBytes(32).toString("hex"), NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
child.stdout.resume();
child.stderr.resume();
const stopped = new Promise((done) => child.once("exit", done));
let cookie;
async function api(path, body, headers = {}) {
  return fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function create(path, body) {
  const response = await api(path, body);
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
try {
  let ready = false;
  for (let n = 0; n < 160; n++) {
    try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await delay(250);
  }
  assert.ok(ready, "production server starts");
  const login = await api("/api/auth/login", { password });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "dashboard login provides a session");
  const { node } = await create("/api/provider-nodes", { name: "Smoke provider", prefix: "local", apiType: "chat",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  await create("/api/providers", { provider: node.id, apiKey: "smoke-upstream-key", name: "Smoke connection", testStatus: "active" });
  const key = await create("/api/keys", { name: "Smoke forced key", permissions: {
    providerIds: [node.id], forceProviderId: node.id, forceModel: "local/model-a",
  } });
  const headers = { Authorization: `Bearer ${key.key}` };
  const dashboardModels = await api("/api/models/available");
  assert.equal(dashboardModels.status, 200);
  assert.ok((await dashboardModels.json()).models.some((m) => m.id === "local/model-b"));
  const models = await api("/v1/models", undefined, headers);
  assert.equal(models.status, 200);
  assert.deepEqual((await models.json()).data.map((m) => m.id), ["local/model-a"]);
  assert.equal((await api("/v1/models/local/model-b", undefined, headers)).status, 404);
  for (const model of [undefined, "other/ignored"]) {
    const completion = await api("/v1/chat/completions", { ...(model ? { model } : {}),
      messages: [{ role: "user", content: "Hello" }], stream: false }, headers);
    assert.equal(completion.status, 200, "forced chat succeeds");
    assert.equal((await completion.json()).choices[0].message.content, "smoke ok");
  }
  assert.deepEqual(dispatched, ["model-a", "model-a"]);
  assert.equal((await api("/v1/embeddings", { model: "other/model-b", input: "Hello" }, headers)).status, 403);
  assert.equal((await api("/v1beta/models", undefined, headers)).status, 403);
  assert.equal((await api("/dashboard/endpoint")).status, 200);
  console.log("PASS: production login, custom provider, SQLite key persistence, full dashboard catalogue, scoped public catalogue/detail, omitted/overridden model, unsupported-service denial, dashboard page");
} finally {
  child.kill();
  await Promise.race([stopped, delay(5000)]);
  await new Promise((done) => upstream.close(done));
  assert.ok(dataDir.startsWith(join(tmpdir(), "9router-production-policy-")), "cleanup confined to test directory");
  await rm(dataDir, { recursive: true, force: true });
}
