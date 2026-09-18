// Run against a disposable 9router database, never the user's running instance:
// CHATGPT_QA_PASSWORD=... node scripts/test-chatgpt-integration.mjs http://127.0.0.1:20237 --disposable
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBridge } from "../public/9router-codex.mjs";

const base = new URL(process.argv[2]);
if (!process.argv.includes("--disposable") || !["127.0.0.1", "localhost"].includes(base.hostname)) {
  throw new Error("This smoke test creates providers and keys. Pass a loopback URL for a disposable database and --disposable.");
}
const received = [];
let autoHighTokensSent = false;
let largePartsSeen = 0;
let largeSeedSent = false;
let truncatedPartsSeen = 0;
let recoveredPartsSeen = 0;
const fixture = http.createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ data: [{ id: "glm-5.3" }] }));
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  received.push({ url: req.url, headers: req.headers, body });
  assert.equal(req.headers.authorization, "Bearer fixture-upstream-key");
  assert.equal(req.headers["chatgpt-account-id"], undefined);
  assert.ok(!JSON.stringify(body).includes("9router.compaction.v1."), "The provider must receive the restored summary, never opaque state");
  for (const message of body.messages || []) {
    if (message.role === "assistant" && JSON.stringify(message.content).includes("QA_SUMMARY")) {
      assert.equal(typeof message.content, "string", "Text-only assistant arrays are not portable to every Chat provider");
    }
  }
  if (body.messages?.some(message => message.role === "user" && /Continue after (manual|repeated|automatic) compaction|Continue the saved task/.test(JSON.stringify(message.content)))) {
    assert.match(JSON.stringify(body.messages), /QA_SUMMARY/, "Codex must retain the summary across compaction and restart");
  }
  const userMessages = (body.messages || []).filter(message => message.role === "user").map(message => typeof message.content === "string" ? message.content : (message.content || []).map(part => part.text || "").join("\n"));
  const userText = userMessages.join("\n");
  const latestUserText = userMessages.at(-1) || "";
  if (body.stream === false && userText.includes("LARGE_FACT_")) {
    assert.ok(Buffer.byteLength(userText) <= 262144, "Large compaction must bound the real provider prompt");
    largePartsSeen++;
  }
  if (latestUserText.includes("Continue after large compaction")) {
    assert.ok(largePartsSeen > 2, "The built server must summarize several parts before merging");
    for (const marker of ["LARGE_FACT_START", "LARGE_FACT_MIDDLE", "LARGE_FACT_END"]) {
      assert.ok(JSON.stringify(body.messages).includes(marker), `Lost fact after large compaction: ${marker}`);
    }
  }
  if (latestUserText.includes("Continue after retry compaction")) {
    assert.ok(truncatedPartsSeen > 0 && recoveredPartsSeen > 0, "The real translator must retry a truncated provider response");
    for (const marker of ["RETRY_FACT_START", "RETRY_FACT_MIDDLE", "RETRY_FACT_END"]) {
      assert.ok(JSON.stringify(body.messages).includes(marker), `Lost fact after retry compaction: ${marker}`);
    }
  }
  const toolResult = body.messages?.some(message => message.role === "tool");
  const tool = !toolResult && body.tools?.some(item => item.function?.name === "read_file");
  // Codex adds environment/user context before the current user message.
  const largeSeed = body.stream === true && /\bLARGE_COMPACT_SEED\b/.test(latestUserText);
  if (largeSeed) largeSeedSent = true;
  const summaryMarkers = [...new Set(userText.match(/(?:LARGE|RETRY)_FACT_(?:START|MIDDLE|END)/g) || [])];
  const truncateSummary = body.stream === false && userText.includes("RETRY_FACT_START") && Buffer.byteLength(userText) > 130000;
  if (truncateSummary) truncatedPartsSeen++;
  else if (body.stream === false && userText.includes("RETRY_FACT_START")) recoveredPartsSeen++;
  const message = tool ? { role: "assistant", content: null, tool_calls: [{ id: "call_qa", type: "function", function: { name: "read_file", arguments: '{"path":"hello.txt"}' } }] }
    : { role: "assistant", content: largeSeed
      ? "LARGE_FACT_START\n" + "Build log: checked app.js successfully.\n".repeat(15000) + "\nLARGE_FACT_MIDDLE\n" + "Test log: confirmed unchanged behavior.\n".repeat(15000) + "\nLARGE_FACT_END"
      : body.stream === false ? "QA_SUMMARY: read hello.txt; continue the task. " + summaryMarkers.join(" ") : "QA_OK" };
  const choice = { index: 0, message, finish_reason: truncateSummary ? "length" : tool ? "tool_calls" : "stop" };
  if (body.stream) {
    const autoSeed = !autoHighTokensSent && body.messages?.some(message => message.role === "user" && JSON.stringify(message.content).includes("AUTO_COMPACT_SEED"));
    if (autoSeed) autoHighTokensSent = true;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const delta = { ...message };
    if (delta.tool_calls) delta.tool_calls[0].index = 0;
    res.write(`data: ${JSON.stringify({ id: "chatcmpl-qa", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "chatcmpl-qa", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "chatcmpl-qa", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: autoSeed ? 300000 : 20, completion_tokens: 10, total_tokens: autoSeed ? 300010 : 30 } })}\n\n`);
    return res.end("data: [DONE]\n\n");
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ id: "chatcmpl-qa", object: "chat.completion", model: body.model, choices: [choice], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
let cookie, key, connection, node, bridge;
const prefix = `qa${Date.now()}`;
async function api(route, method = "GET", body) {
  const response = await fetch(new URL(route, base), { method, headers: { cookie: cookie || "", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.ok(response.ok, `${route}: HTTP ${response.status}, ${data.error}`);
  return data;
}
try {
  const login = await fetch(new URL("/api/auth/login", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.CHATGPT_QA_PASSWORD }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  await api("/api/settings", "PATCH", { rtkEnabled: false, headroomEnabled: false, enableObservability: false });
  key = await api("/api/keys", "POST", { name: prefix });
  ({ node } = await api("/api/provider-nodes", "POST", { name: "ChatGPT QA fixture", prefix, apiType: "chat", baseUrl: `http://127.0.0.1:${fixture.address().port}/v1` }));
  const added = await api("/api/providers", "POST", { provider: node.id, apiKey: "fixture-upstream-key", name: prefix });
  connection = added.connection || added;
  await api("/api/chatgpt", "PUT", { models: [`${prefix}/glm-5.3`] });
  assert.equal((await api("/api/chatgpt")).models[0].id, `${prefix}/glm-5.3`);
  const manifestResponse = await fetch(new URL("/api/chatgpt/v1/models", base), { headers: { authorization: `Bearer ${key.key}` } });
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.models.length, 1);
  assert.deepEqual(manifest.models[0].reasoningLevels, ["low", "high", "max"]);
  assert.equal((await fetch(new URL("/api/chatgpt/v1/models", base))).status, 401);
  bridge = createBridge({ token: "qa-local-token", routerUrl: `${base.origin}/api/chatgpt/v1`, apiKey: key.key }, { getManifest: async () => manifest });
  bridge.listen(0, "127.0.0.1"); await once(bridge, "listening");
  const endpoint = `http://127.0.0.1:${bridge.address().port}/qa-local-token/v1`;
  async function completion(suffix, body) {
    const result = await fetch(`${endpoint}${suffix}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer fake-native-secret", "chatgpt-account-id": "fake-native-account" },
      body: JSON.stringify({ model: manifest.models[0].slug, ...body }),
    });
    const text = await result.text();
    assert.equal(result.status, 200, text.slice(0, 1500));
    return text;
  }
  const first = await completion("/responses", {
    input: [{ role: "user", content: "Read hello.txt" }], stream: true, reasoning: { effort: "max" },
    tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
  });
  assert.match(first, /response\.completed/);
  assert.match(first, /function_call/);
  assert.match(first, /call_qa/);
  assert.equal(received[0].body.reasoning_effort, "max");
  const history = [{ role: "user", content: "Read hello.txt" },
    { type: "function_call", call_id: "call_qa", name: "read_file", arguments: '{"path":"hello.txt"}' },
    { type: "function_call_output", call_id: "call_qa", output: "hello world" }];
  assert.match(await completion("/responses", { input: history, stream: true }), /QA_OK/);
  const compact = JSON.parse(await completion("/responses/compact", { input: history }));
  assert.equal(compact.object, "response.compaction");
  assert.equal(compact.output.length, 1);
  assert.equal(compact.output[0].type, "compaction");
  assert.match(compact.output[0].encrypted_content, /^9router\.compaction\.v1\./);
  assert.match(await completion("/responses", { input: [...compact.output, { role: "user", content: "Continue" }], stream: true }), /QA_OK/);
  assert.match(JSON.stringify(received.at(-1).body.messages), /QA_SUMMARY/);
  assert.ok(!JSON.stringify(received.at(-1).body).includes(compact.output[0].encrypted_content));
  const v2 = await completion("/responses", { input: [...compact.output, ...history, { type: "compaction_trigger" }], stream: true });
  const events = v2.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const items = events.filter(event => event.type === "response.output_item.done");
  assert.equal(items.length, 1);
  assert.equal(items[0].item.type, "compaction");
  assert.equal(events.at(-1).type, "response.completed");
  assert.match(JSON.stringify(received.at(-1).body.messages), /QA_SUMMARY/);
  assert.ok(!JSON.stringify(received.at(-1).body).includes("compaction_trigger"));
  assert.match(await completion("/responses", { input: [items[0].item, { role: "user", content: "Continue after v2" }], stream: true }), /QA_OK/);
  assert.match(JSON.stringify(received.at(-1).body.messages), /QA_SUMMARY/);
  assert.ok(!JSON.stringify(received.at(-1).body).includes(items[0].item.encrypted_content));
  const script = await fetch(new URL("/9router-codex.mjs", base));
  assert.equal(script.status, 200);
  const scriptText = await script.text();
  assert.match(scriptText, /export async function main/);
  assert.equal(received.length, 6);
  const largeInput = [{ role: "user", content: "LARGE_FACT_START\n" + "Bounded history fixture.\n".repeat(15000) + "\nLARGE_FACT_MIDDLE\n" + "Saved test output.\n".repeat(15000) + "\nLARGE_FACT_END" }, { type: "compaction_trigger" }];
  const large = await completion("/responses", { input: largeInput, stream: true });
  const largeEvents = large.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const largeItems = largeEvents.filter(event => event.type === "response.output_item.done");
  assert.equal(largeItems.length, 1);
  assert.equal(largeEvents[0].type, "ping");
  assert.equal(largeEvents.at(-1).type, "response.completed");
  await completion("/responses", { input: [largeItems[0].item, { role: "user", content: "Continue after large compaction" }], stream: true });
  const retryInput = [{ role: "user", content: "RETRY_FACT_START\n" + "dense-history-01 passed\n".repeat(15000) +
    "\nRETRY_FACT_MIDDLE\n" + "dense-history-02 passed\n".repeat(15000) + "\nRETRY_FACT_END" }, { type: "compaction_trigger" }];
  const retryEvents = (await completion("/responses", { input: retryInput, stream: true })).split("\n")
    .filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const retryItems = retryEvents.filter(event => event.type === "response.output_item.done");
  assert.equal(retryItems.length, 1);
  assert.equal(retryEvents.at(-1).type, "response.completed");
  await completion("/responses", { input: [retryItems[0].item, { role: "user", content: "Continue after retry compaction" }], stream: true });
  console.log("PASS: persisted selection → local bridge → built server → real translator → fixture provider; tools, legacy and v2 compaction, repeated compaction and decoded continuation; separate auth; downloadable installer.");
  if (process.argv.includes("--check-codex")) {
    largePartsSeen = 0;
    const { checkCodexCompaction } = await import("./test-chatgpt-codex.mjs");
    try {
      await checkCodexCompaction(endpoint, manifest);
      assert.ok(largeSeedSent, "Codex must actually receive the large assistant history fixture");
    }
    catch (error) { console.error(`Fixture high-token seed sent: ${autoHighTokensSent}`); throw error; }
  }
  if (process.argv.includes("--check-installer")) {
    const exec = promisify(execFile);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "9router-installer-smoke-"));
    const codexHome = path.join(temporary, "codex home");
    const installer = path.join(temporary, "installer.mjs");
    await fs.mkdir(codexHome);
    await fs.writeFile(installer, scriptText);
    const configPath = path.join(codexHome, "config.toml");
    const original = 'model = "native-qa"\n[features]\nqa_preserve = true\n';
    await fs.writeFile(configPath, original);
    await fs.writeFile(path.join(codexHome, "auth.json"), "untouched-auth-sentinel");
    await fs.writeFile(path.join(codexHome, "models_cache.json"), JSON.stringify({ models: [{ slug: "native-qa", visibility: "list", priority: 0 }] }));
    const allocator = http.createServer();
    allocator.listen(0, "127.0.0.1"); await once(allocator, "listening");
    const port = allocator.address().port;
    await new Promise(resolve => allocator.close(resolve));
    const run = command => exec(process.execPath, [installer, command, "--codex-home", codexHome, "--url", `${base.origin}/api/chatgpt/v1`, "--port", String(port)], { env: { ...process.env, ROUTER9_API_KEY: key.key }, timeout: 30000 });
    try {
      assert.match((await run("enable")).stdout, /Using API key from ROUTER9_API_KEY/);
      assert.match((await run("status")).stdout, /Running:/);
      const state = JSON.parse(await fs.readFile(path.join(codexHome, "9router-chatgpt/state.json"), "utf8"));
      assert.equal((await fs.stat(path.join(codexHome, "9router-chatgpt/state.json"))).mode & 0o777, 0o600);
      await fs.writeFile(configPath, (await fs.readFile(configPath, "utf8")).replace("qa_preserve = true", "qa_preserve = false"));
      await run("enable");
      await run("sync");
      await run("disable");
      assert.equal(await fs.readFile(configPath, "utf8"), original.replace("qa_preserve = true", "qa_preserve = false"));
      assert.equal(await fs.readFile(path.join(codexHome, "auth.json"), "utf8"), "untouched-auth-sentinel");
      await assert.rejects(fs.stat(state.plist), { code: "ENOENT" });
      assert.match((await run("status")).stdout, /Disabled/);
      console.log("PASS: downloaded installer, real temporary launchd agent, repeated enable, sync, disable, unrelated config edits retained, auth file unchanged, launch agent removed.");
    } finally {
      await run("disable").catch(() => {});
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
} finally {
  if (cookie) {
    await api("/api/chatgpt", "PUT", { models: [] }).catch(() => {});
    if (connection?.id) await api(`/api/providers/${connection.id}`, "DELETE").catch(() => {});
    if (node?.id) await api(`/api/provider-nodes/${node.id}`, "DELETE").catch(() => {});
    if (key?.id) await api(`/api/keys/${key.id}`, "DELETE").catch(() => {});
  }
  if (bridge) { bridge.closeAllConnections(); bridge.close(); }
  fixture.closeAllConnections(); fixture.close();
}
