import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Run: node scripts/prompt-retention-check.mjs (Node >= 22.15).
const root = new URL("../", import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  let mapped = specifier.startsWith("@/") ? new URL(`src/${specifier.slice(2)}`, root)
    : specifier.startsWith("open-sse/") ? new URL(specifier, root) : null;
  if (specifier === "node-machine-id" && !context.conditions.includes("require")) return nextResolve('data:text/javascript,import { createRequire } from "node:module"; const { machineIdSync } = createRequire(' + JSON.stringify(new URL("package.json", root).href) + ')("node-machine-id"); export { machineIdSync };', context);
  if (specifier === "next/server") mapped = new URL("node_modules/next/server.js", root);
  if (mapped) {
    if (!existsSync(mapped) && existsSync(`${fileURLToPath(mapped)}.js`)) mapped = new URL(`${mapped.href}.js`);
    return nextResolve(mapped.href, context);
  }
  return nextResolve(specifier, context);
} });
const dir = await mkdtemp(join(tmpdir(), "9router-retention-"));
process.env.DATA_DIR = dir;
process.env.ENABLE_REQUEST_LOGS = "true";
const realNow = Date.now;
const originalFetch = globalThis.fetch;
let adapter;
try {
  const db = await import("../src/lib/db/index.js");
  adapter = await (await import("../src/lib/db/driver.js")).getAdapter();
  await db.updateSettings({ observabilityBatchSize: 1 });
  const retention = await import("../src/lib/promptRetention.js");
  const off = await db.createApiKey("off", "check-machine");
  const on = await db.createApiKey("on", "check-machine");
  assert.equal(off.promptRetentionEnabled, false);
  assert.equal(await retention.createPromptRetentionContext(), null);
  assert.equal(await retention.createPromptRetentionContext("unknown"), null);
  assert.equal(await retention.createPromptRetentionContext(off.key), null);
  await db.updateApiKey(on.id, { promptRetentionEnabled: true });
  const context = await retention.createPromptRetentionContext(on.key);
  const secret = "PRIVATE-PROMPT-CHECK";
  async function save(id, ctx = context) {
    await db.saveRequestDetail({ id, model: "check", promptRetentionContext: ctx,
      request: { messages: [{ role: "user", content: secret }] }, response: { content: "PRIVATE-ANSWER-CHECK" } });
    await new Promise(resolve => setImmediate(resolve));
  }
  await save("off", null);
  await save("on");
  assert.equal((await db.getRequestDetailById("off")).request.redacted, true);
  assert.equal((await db.getRequestDetailById("on")).request.messages[0].content, secret);
  assert.ok(!JSON.stringify(adapter.all("SELECT data FROM requestDetails")).includes("PRIVATE-"));
  assert.ok(!(await db.getRequestDetails({ includePayload: false })).details.some(d => JSON.stringify(d).includes(secret)));

  const { NextRequest } = await import("next/server.js");
  const api = await import("../src/app/api/keys/[id]/route.js");
  const usage = await import("../src/app/api/usage/request-details/route.js");
  const { createDashboardAuthToken } = await import("../src/lib/auth/dashboardSession.js");
  const url = "http://localhost/api/usage/request-details";
  const anonymous = await usage.GET(new NextRequest(url));
  assert.ok(!JSON.stringify(await anonymous.json()).includes(secret));
  const authenticated = await usage.GET(new NextRequest(url, { headers: { cookie: `auth_token=${await createDashboardAuthToken()}` } }));
  assert.ok(JSON.stringify(await authenticated.json()).includes(secret));
  assert.equal(authenticated.headers.get("cache-control"), "no-store");
  for (const invalid of ["true", 1, null]) {
    const res = await api.PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({ promptRetentionEnabled: invalid }) }), { params: Promise.resolve({ id: on.id }) });
    assert.equal(res.status, 400);
  }
  await db.updateApiKey(on.id, { promptRetentionEnabled: false });
  assert.equal(retention.getRetainedPromptData("on"), null);
  await db.updateApiKey(on.id, { promptRetentionEnabled: true });
  await save("late-old-stream", context);
  assert.equal(retention.getRetainedPromptData("late-old-stream"), null);
  const fresh = await retention.createPromptRetentionContext(on.key);
  await save("expiry", fresh);
  const expires = Date.parse(retention.getRetainedPromptData("expiry").promptRetentionExpiresAt);
  Date.now = () => expires;
  assert.equal(retention.getRetainedPromptData("expiry"), null);
  await save("expired-stream", fresh);
  assert.equal(retention.getRetainedPromptData("expired-stream"), null);
  Date.now = realNow;
  await save("paused", await retention.createPromptRetentionContext(on.key));
  await db.updateApiKey(on.id, { isActive: false });
  assert.equal(retention.getRetainedPromptData("paused"), null);
  assert.equal(await retention.createPromptRetentionContext(on.key), null);
  await db.updateApiKey(on.id, { isActive: true });
  const bounded = await retention.createPromptRetentionContext(on.key);
  for (let i = 0; i < 3; i++) retention.retainPromptData(`bounded-${i}`, bounded, { request: secret }, 2);
  assert.equal(retention.getRetainedPromptData("bounded-0"), null);
  assert.equal(retention.getRetainedPromptData("bounded-2").request, secret);
  const exported = await db.exportDb();
  assert.equal(exported.apiKeys.find(k => k.id === on.id).promptRetentionEnabled, true);
  await db.importDb(exported);
  assert.equal(retention.getRetainedPromptData("bounded-2"), null);
  await assert.rejects(db.importDb({ apiKeys: [{ ...off, promptRetentionEnabled: "true" }] }), /must be a boolean/);
  await db.importDb({ apiKeys: [{ ...off, promptRetentionEnabled: undefined }].map(({ promptRetentionEnabled, ...key }) => key) });
  assert.equal((await db.getApiKeyById(off.id)).promptRetentionEnabled, false);

  // Exercise real streaming, JSON, error, and forced-SSE capture paths; no upstream calls.
  const { handleChatCore } = await import("../open-sse/handlers/chatCore.js");
  const executor = (await import("../open-sse/executors/index.js")).getExecutor("openai");
  await db.updateApiKey(off.id, { promptRetentionEnabled: true });
  const { PROVIDERS } = await import("../open-sse/config/providers.js");
  for (const mode of ["json", "stream", "error", "forced"]) {
    PROVIDERS.openai.forceStream = mode === "forced";
    const marker = `PRIVATE-${mode}`;
    const providerResponse = mode === "error" ? Response.json({ error: { message: "rejected" } }, { status: 400 })
      : mode === "json" ? Response.json({ id: "check", choices: [{ message: { role: "assistant", content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } })
      : new Response('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    executor.execute = async ({ body }) => ({ response: providerResponse, url: "https://example.invalid", headers: {}, transformedBody: body });
    const result = await handleChatCore({ body: { model: "gpt-4o-mini", messages: [{ role: "user", content: marker }], stream: mode === "stream" }, modelInfo: { provider: "openai", model: "gpt-4o-mini" }, credentials: { apiKey: "test-upstream-key" }, apiKey: off.key, clientRawRequest: { endpoint: "/v1/chat/completions", headers: { accept: mode === "stream" ? "text/event-stream" : "application/json" } } });
    if (result.response) await result.response.text();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.success, mode !== "error", `${mode} response status`);
    assert.ok(JSON.stringify((await db.getRequestDetails()).details).includes(mode === "error" ? "rejected" : "answer"), `${mode} response payload missing`);
    assert.ok(JSON.stringify((await db.getRequestDetails()).details).includes(marker), `${mode} capture missing`);
  }
  assert.ok(!JSON.stringify(adapter.all("SELECT data FROM requestDetails")).includes("PRIVATE-"));
  await db.deleteApiKey(off.id);
  assert.ok(!(await db.getRequestDetails()).details.some(d => JSON.stringify(d).includes("PRIVATE-json")));
  retention.purgeRetainedPrompts();
  console.log("Prompt retention checks passed: opt-in, auth, expiry, purge, bounds, import, streaming/JSON/error paths, metadata-only disk writes");
} finally {
  Date.now = realNow;
  globalThis.fetch = originalFetch;
  adapter?.close();
  await rm(dir, { recursive: true, force: true });
}
