import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let buildOnStreamComplete;
let createPassthroughStreamWithLogger;
let createSSETransformStreamWithLogger;
let db;
let FORMATS;
let handleForcedSSEToJson;
let rawDb;
let saveUsageStats;
let tempDir;

async function drainThrough(transform, input) {
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(input));
      controller.close();
    },
  });
  await new Response(source.pipeThrough(transform)).text();
}

async function waitForUsageRow() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const count = rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count;
    if (count === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for usage persistence");
}

async function waitForUsageAttempt() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function createReservedStream(name) {
  const key = await db.createApiKey(name, "machine-test", 100);
  const reservation = await db.reserveApiKeyUsage(key.key, 50);
  const body = { model: "openai/gpt-4o", messages: [], stream: true };
  const { onStreamComplete } = buildOnStreamComplete({
    provider: "openai",
    model: "gpt-4o",
    connectionId: "connection-test",
    apiKey: key.key,
    usageReservationId: reservation.reservationId,
    requestStartTime: Date.now(),
    body,
    stream: true,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
  });
  return { body, key, onStreamComplete, reservation };
}

function openAiUsageStream(usage) {
  return [
    `data: ${JSON.stringify({ id: "chatcmpl-authority", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] })}`,
    "",
    `data: ${JSON.stringify({ id: "chatcmpl-authority", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

function responsesUsageStream(usage) {
  return [
    "event: response.completed",
    `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp-authority", status: "completed", usage } })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

async function drainOpenAiUsage(context, usage) {
  const transform = createPassthroughStreamWithLogger(
    "openai", null, "gpt-4o", "connection-test", context.body, context.onStreamComplete, context.key.key,
  );
  await drainThrough(transform, openAiUsageStream(usage));
}

async function drainResponsesUsage(context, usage) {
  const transform = createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.OPENAI_RESPONSES,
    "codex",
    null,
    null,
    "gpt-5-codex",
    "connection-test",
    context.body,
    context.onStreamComplete,
    context.key.key,
  );
  await drainThrough(transform, responsesUsageStream(usage));
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-stream-authority-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ instance: rawDb } = global._dbAdapter);
  ({ FORMATS } = await import("../../open-sse/translator/formats.js"));
  ({ createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  ({ buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js"));
  ({ handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js"));
  ({ saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js"));
});

beforeEach(() => {
  rawDb.transaction(() => {
    rawDb.run("DELETE FROM apiKeyUsageReservations");
    rawDb.run("DELETE FROM usageHistory");
    rawDb.run("DELETE FROM usageDaily");
    rawDb.run("DELETE FROM apiKeys");
  });
});

afterAll(() => {
  try { rawDb?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("stream usage reservation authority", () => {
  it.each(["passthrough", "translated"])(
    "keeps the reservation for %s content when upstream usage is missing",
    async (mode) => {
      const key = await db.createApiKey(`${mode}-key`, "machine-test", 1_000_000);
      const reservation = await db.reserveApiKeyUsage(key.key, 100_000);
      const body = { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }], stream: true };
      const { onStreamComplete } = buildOnStreamComplete({
        provider: "openai",
        model: "gpt-4o",
        connectionId: "connection-test",
        apiKey: key.key,
        usageReservationId: reservation.reservationId,
        requestStartTime: Date.now(),
        body,
        stream: true,
        clientRawRequest: { endpoint: "/v1/chat/completions" },
      });
      const sse = [
        `data: ${JSON.stringify({ id: "chatcmpl-test", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] })}`,
        "",
        `data: ${JSON.stringify({ id: "chatcmpl-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n");
      const transform = mode === "passthrough"
        ? createPassthroughStreamWithLogger("openai", null, "gpt-4o", "connection-test", body, onStreamComplete, key.key)
        : createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "gpt-4o", "connection-test", body, onStreamComplete, key.key);

      await drainThrough(transform, sse);
      await waitForUsageRow();

      expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [reservation.reservationId])).toBeDefined();
      const usage = rawDb.get("SELECT tokens, meta FROM usageHistory WHERE apiKey = ?", [key.key]);
      expect(JSON.parse(usage.tokens)).toMatchObject({ estimated: true });
      expect(usage.tokens).not.toContain(reservation.reservationId);
      expect(usage.meta).not.toContain(reservation.reservationId);
    },
  );

  it.each([
    {
      name: "Chat Completions",
      provider: "openai",
      model: "gpt-4o",
      sourceFormat: () => FORMATS.OPENAI,
      reasoningTokens: 7,
      sse: () => [
        `data: ${JSON.stringify({
          id: "chatcmpl-reasoning",
          choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            completion_tokens_details: { reasoning_tokens: 7 },
          },
        })}`,
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "Responses",
      provider: "codex",
      model: "gpt-5-codex",
      sourceFormat: () => FORMATS.OPENAI_RESPONSES,
      reasoningTokens: 9,
      sse: () => [
        "event: response.output_item.done",
        `data: ${JSON.stringify({
          output_index: 0,
          item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
        })}`,
        "",
        "event: response.completed",
        `data: ${JSON.stringify({
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              output_tokens_details: { reasoning_tokens: 9 },
            },
          },
        })}`,
        "",
      ].join("\n"),
    },
  ])("persists forced $name reasoning before reconciling", async ({ provider, model, sourceFormat, reasoningTokens, sse }) => {
    const key = await db.createApiKey(`${provider}-reasoning`, "machine-test", 1_000);
    const now = new Date("2026-07-19T12:00:00.000Z");
    const reservation = await db.reserveApiKeyUsage(key.key, 500, now);

    const result = await handleForcedSSEToJson({
      providerResponse: new Response(sse(), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: sourceFormat(),
      provider,
      model,
      body: { model: `${provider}/${model}`, messages: [] },
      stream: false,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "connection-test",
      apiKey: key.key,
      usageReservationId: reservation.reservationId,
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      onRequestSuccess: async () => {},
      trackDone: () => {},
      appendLog: () => {},
      reqTag: "request-test",
      log: null,
    });

    expect(result.success).toBe(true);
    await waitForUsageRow();
    const usage = rawDb.get("SELECT tokens FROM usageHistory WHERE apiKey = ?", [key.key]);
    expect(JSON.parse(usage.tokens)).toMatchObject({ reasoning_tokens: reasoningTokens });
    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toMatchObject({
      usedTokens: 15 + reasoningTokens,
      reservedTokens: 0,
      remainingTokens: 1_000 - 15 - reasoningTokens,
    });
  });

  it("reconciles authoritative reasoning-only usage", async () => {
    const key = await db.createApiKey("reasoning-only", "machine-test", 100);
    const reservation = await db.reserveApiKeyUsage(key.key, 50);

    saveUsageStats({
      provider: "openai",
      model: "reasoning-model",
      tokens: { reasoning_tokens: 7 },
      connectionId: "connection-test",
      apiKey: key.key,
      usageReservationId: reservation.reservationId,
      silent: true,
    });
    await waitForUsageRow();

    expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [reservation.reservationId])).toBeUndefined();
    expect(await db.getApiKeyUsageLimitStatus(key.key)).toMatchObject({
      usedTokens: 7,
      reservedTokens: 0,
      remainingTokens: 93,
    });
  });

  it("keeps the reservation when real stream normalization sees malformed top-level usage", async () => {
    const context = await createReservedStream("malformed-stream-top-level");

    await drainOpenAiUsage(context, { prompt_tokens: "bad", completion_tokens: 5 });
    await waitForUsageRow();

    expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [context.reservation.reservationId])).toBeDefined();
    expect(JSON.parse(rawDb.get("SELECT tokens FROM usageHistory").tokens)).toMatchObject({ estimated: true });
  });

  it("keeps the reservation when Responses stream normalization sees malformed nested usage", async () => {
    const context = await createReservedStream("malformed-stream-nested");

    await drainResponsesUsage(context, {
      input_tokens: 10,
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: "bad" },
    });
    await waitForUsageAttempt();

    expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [context.reservation.reservationId])).toBeDefined();
    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
  });

  it("reconciles explicit authoritative all-zero streaming usage exactly once", async () => {
    const context = await createReservedStream("all-zero-stream");
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    await drainOpenAiUsage(context, usage);
    await waitForUsageRow();
    await drainOpenAiUsage(context, usage);
    await waitForUsageAttempt();

    expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [context.reservation.reservationId])).toBeUndefined();
    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(1);
    expect(rawDb.get("SELECT promptTokens, completionTokens, tokens FROM usageHistory")).toMatchObject({
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(JSON.parse(rawDb.get("SELECT tokens FROM usageHistory").tokens)).not.toHaveProperty("estimated");
    expect(await db.getApiKeyUsageLimitStatus(context.key.key)).toMatchObject({
      usedTokens: 0,
      reservedTokens: 0,
      remainingTokens: 100,
    });
  });

  it.each([
    ["total-only", { total_tokens: 15 }],
    ["cache-only", { input_tokens_details: { cached_tokens: 15 } }],
  ])("keeps the reservation for unsupported %s Responses stream authority", async (_name, usage) => {
    const context = await createReservedStream(`partial-${_name}`);

    await drainResponsesUsage(context, usage);
    await waitForUsageAttempt();

    expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [context.reservation.reservationId])).toBeDefined();
    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
  });
});
