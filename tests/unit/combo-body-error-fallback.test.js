import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

/**
 * A combo [bad, good] through the real stack, where `bad` is an upstream that
 * reports a failure *inside* an HTTP 200 — the way kimchi answers when a model's
 * provider has no credits left: `{"error": "...has exhausted its credits..."}`
 * as the whole JSON body, or as the first SSE frame. The status is 200, so
 * nothing downstream saw a failure: the error reached the client as if it were
 * the answer, and neither account fallback nor the combo moved on.
 *
 * Pinned here: whatever form the failure takes, the request is answered by the
 * next model of the combo, in streaming and non-streaming mode alike, and a
 * model that is out of credits is not asked again straight away.
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

const CREDITS = "the provider for model kimi-k2.7 has exhausted its credits and cannot process requests";
const originalDataDir = process.env.DATA_DIR;

let tempDir;
let db;
let handleChat;
let badServer;
let goodServer;
let badMode = "json-error";
let badHits = 0;
let goodHits = 0;

function listen(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* not JSON */ }
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const sseFrame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

function answer(res, body, text) {
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(sseFrame({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] }));
    res.write(sseFrame({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
    res.end("data: [DONE]\n\n");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    id: "c1", object: "chat.completion", created: 1, model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-body-error-"));
  process.env.DATA_DIR = tempDir;
  // A short hold window keeps the "error behind the first content" cases quick.
  process.env.STREAM_ERROR_HOLD_MS = "300";

  badServer = await listen((req, res, body) => {
    badHits += 1;
    switch (badMode) {
      case "json-error":
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: CREDITS }));
        break;
      case "json-error-object":
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: CREDITS, type: "billing_error" } }));
        break;
      case "sse-error-frame":
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseFrame({ error: CREDITS }));
        res.end("data: [DONE]\n\n");
        break;
      case "sse-error-event":
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`);
        break;
      case "raw-json-in-sse":
        // content-type says SSE, the body is a bare JSON error with no `data:` framing
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(JSON.stringify({ error: CREDITS }));
        break;
      case "error-after-content":
      case "late-error":
        // Content first, the failure right behind it (inside the hold window) or well after it.
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(sseFrame({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "partial answer" }, finish_reason: null }] }));
        setTimeout(() => { res.write(sseFrame({ error: CREDITS })); res.end("data: [DONE]\n\n"); }, badMode === "late-error" ? 800 : 30);
        break;
      case "http-402":
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: CREDITS }));
        break;
      case "ok":
      default:
        answer(res, body, "from-bad");
    }
  });
  goodServer = await listen((req, res, body) => {
    goodHits += 1;
    answer(res, body, "from-good");
  });

  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ requireApiKey: false });
  for (const [id, prefix, server] of [["openai-compatible-bad", "bad", badServer], ["openai-compatible-good", "good", goodServer]]) {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const node = await db.createProviderNode({ id, type: "openai-compatible", name: prefix, prefix, apiType: "chat", baseUrl });
    await db.createProviderConnection({
      provider: node.id, authType: "apikey", name: prefix, apiKey: "k", isActive: true, defaultModel: "test-model",
      providerSpecificData: { prefix, apiType: "chat", baseUrl, nodeName: prefix },
    });
  }
  await db.createCombo({ name: "creditless", models: ["bad/test-model", "good/test-model"], kind: "fallback" });
  ({ handleChat } = await import("@/sse/handlers/chat.js"));
});

afterAll(async () => {
  await Promise.all([badServer, goodServer].map((s) => new Promise((r) => s?.close(r))));
  if (originalDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
  delete process.env.STREAM_ERROR_HOLD_MS;
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* locked on Windows */ }
});

beforeEach(async () => {
  badHits = 0;
  goodHits = 0;
  badMode = "json-error";
  // A model locked by an earlier scenario must not leak into the next one.
  const rows = await db.getProviderConnections({ provider: "openai-compatible-bad" });
  for (const row of rows) {
    const clear = Object.fromEntries(Object.keys(row).filter((k) => k.startsWith("modelLock_")).map((k) => [k, null]));
    await db.updateProviderConnection(row.id, { isActive: true, testStatus: "active", rateLimitedUntil: null, backoffLevel: 0, ...clear });
  }
});

async function ask({ stream }) {
  const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "creditless", messages: [{ role: "user", content: "hi" }], stream }),
  }));
  const text = await response.text();
  let content = "";
  if (stream) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      try { content += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content || ""; } catch { /* not a chunk */ }
    }
  } else {
    try { content = JSON.parse(text).choices?.[0]?.message?.content || ""; } catch { /* not JSON */ }
  }
  return { status: response.status, content, text };
}

const FAILURES = [
  ["a bare {error} JSON body with status 200", "json-error", [false]],
  ["an {error:{message}} JSON body with status 200", "json-error-object", [false]],
  ["an error as the first SSE frame", "sse-error-frame", [true]],
  ["an `event: error` SSE frame", "sse-error-event", [true]],
  ["a bare JSON error behind an SSE content-type", "raw-json-in-sse", [true]],
  ["an error right behind the first content frame (inside the hold window)", "error-after-content", [true]],
  ["a plain HTTP 402 (already worked; guards against regressions)", "http-402", [true, false]],
];

describe("a combo whose first model fails inside an HTTP 200", () => {
  for (const [label, mode, streams] of FAILURES) {
    for (const stream of streams) {
      it(`falls through to the next model on ${label} (stream=${stream})`, async () => {
        badMode = mode;
        const out = await ask({ stream });
        expect(out.status).toBe(200);
        expect(out.content).toBe("from-good");
        expect(out.text).not.toContain("exhausted its credits");
        expect(badHits).toBe(1);
        expect(goodHits).toBe(1);
      });
    }
  }

  it("does not ask a model that is out of credits again straight away", async () => {
    badMode = "sse-error-frame";
    const first = await ask({ stream: true });
    expect(first.content).toBe("from-good");
    expect(badHits).toBe(1);

    // Credits do not come back in seconds: the model is locked, so the next
    // requests go to the second step without spending a call on the first.
    badMode = "ok";
    const second = await ask({ stream: true });
    const third = await ask({ stream: false });
    expect(second.content).toBe("from-good");
    expect(third.content).toBe("from-good");
    expect(badHits).toBe(1);
  });

  it("still streams a healthy first model untouched, ending in exactly one [DONE]", async () => {
    badMode = "ok";
    const out = await ask({ stream: true });
    expect(out.status).toBe(200);
    expect(out.content).toBe("from-bad");
    expect(goodHits).toBe(0);
    expect(out.text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(out.text.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it("after the hold window an error can no longer fail over: the client gets the partial answer, then a standard error frame and one [DONE]", async () => {
    badMode = "late-error";
    const out = await ask({ stream: true });
    expect(out.status).toBe(200);
    expect(out.content).toBe("partial answer");
    expect(goodHits).toBe(0);
    const errors = out.text.split("\n").filter((l) => l.startsWith("data:") && l.includes('"error"'));
    expect(errors).toHaveLength(1);
    // Not the upstream's bare string, but the shape OpenAI clients read a message from.
    const error = JSON.parse(errors[0].slice(5)).error;
    expect(error).toMatchObject({ message: expect.stringContaining("exhausted its credits"), type: "billing_error" });
    expect(out.text.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it("returns the error, not a hang or a fake answer, when every model fails the same way", async () => {
    badMode = "sse-error-frame";
    // Point the second step at the same failing behaviour by emptying the combo's good seat.
    await db.updateCombo?.((await db.getComboByName("creditless")).id, { models: ["bad/test-model"] });
    try {
      const out = await ask({ stream: true });
      expect(out.status).toBeGreaterThanOrEqual(400);
      expect(out.text).toContain("exhausted its credits");
    } finally {
      await db.updateCombo?.((await db.getComboByName("creditless")).id, { models: ["bad/test-model", "good/test-model"] });
    }
  });
});
