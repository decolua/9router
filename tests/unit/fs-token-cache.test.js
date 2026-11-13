import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../translator/registerAll.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    execute: executeMock,
    noAuth: true,
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
    appendProviderChunk: vi.fn(),
    appendConvertedChunk: vi.fn(),
  }),
}));

const {
  getBlockCacheSync,
  setBlockCacheSync,
  buildResponseCacheKey,
  setResponseCacheSync,
  getFsCacheStatus,
  clearFsCacheSync,
  pruneFsCacheSync,
} = await import("../../open-sse/rtk/fsCache.js");
const { compressMessages } = await import("../../open-sse/rtk/index.js");
const { compressWithHeadroom } = await import("../../open-sse/rtk/headroom.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("Raw Filesystem Token Cache (Block/Context Compression Cache & Full Response Cache)", () => {
  let tempCacheDir;

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-token-cache-test-"));
    process.env.TOKEN_CACHE_DIR = tempCacheDir;
    executeMock.mockReset();
  });

  afterEach(() => {
    delete process.env.TOKEN_CACHE_DIR;
    try {
      fs.rmSync(tempCacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("stores and retrieves compressed blocks on raw filesystem and tracks hit/saved stats", () => {
    const rawText = "diff --git a/file.js b/file.js\n" + "+const line = 1;\n".repeat(40);
    const compressedText = "file.js (+40/-0)";

    expect(getBlockCacheSync("rtk", rawText)).toBeNull();
    const ok = setBlockCacheSync("rtk", rawText, compressedText, { meta: { filter: "gitDiff" } });
    expect(ok).toBe(true);

    const hit = getBlockCacheSync("rtk", rawText);
    expect(hit).not.toBeNull();
    expect(hit.content).toBe(compressedText);
    expect(hit.savedBytes).toBe(rawText.length - compressedText.length);
    expect(hit.meta.filter).toBe("gitDiff");

    const status = getFsCacheStatus();
    expect(status.blocks.entries).toBe(1);
    expect(status.blocks.hits).toBe(1);
    expect(status.blocks.misses).toBe(1);
    expect(status.blocks.bytesSaved).toBe(rawText.length - compressedText.length);
  });

  it("reuses RTK block cache across turns even if RTK is later disabled", () => {
    const diffOutput = [
      "diff --git a/src/app.js b/src/app.js",
      "index 1111111..2222222 100644",
      "--- a/src/app.js",
      "+++ b/src/app.js",
      "@@ -1,20 +1,20 @@",
      ...Array.from({ length: 30 }, (_, i) => `+console.log("line ${i} with extra padding to exceed minimum compress size");`),
    ].join("\n");

    const turn1Body = {
      messages: [{ role: "tool", content: diffOutput }],
    };

    const stats1 = compressMessages(turn1Body, true, { blockCacheEnabled: true });
    expect(stats1.hits.length).toBe(1);
    expect(stats1.cacheHits).toBe(0);
    const compressedTurn1 = turn1Body.messages[0].content;
    expect(compressedTurn1.length).toBeLessThan(diffOutput.length);

    // Turn 2: same tool output arrives in history; served directly from raw filesystem block cache
    const turn2Body = {
      messages: [{ role: "tool", content: diffOutput }],
    };
    const stats2 = compressMessages(turn2Body, false, { blockCacheEnabled: true });
    expect(stats2.cacheHits).toBe(1);
    expect(turn2Body.messages[0].content).toBe(compressedTurn1);
  });

  it("caches Headroom compressed message blocks and skips network call when all blocks hit cache", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          messages: req.messages.map((m) => ({
            ...m,
            content: typeof m.content === "string" ? m.content.slice(0, 60) : m.content,
          })),
          tokens_before: 400,
          tokens_after: 50,
          tokens_saved: 350,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const longContent = "Detailed architectural context block ".repeat(20);
      const body1 = {
        messages: [{ role: "user", content: longContent }],
      };

      const res1 = await compressWithHeadroom(body1, {
        enabled: true,
        url: "http://localhost:8787",
        model: "gpt-4o",
        format: "openai",
        blockCacheEnabled: true,
      });
      expect(res1).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const compressedContent = body1.messages[0].content;
      expect(compressedContent.length).toBe(60);

      // Second request with the same message block should hit raw filesystem cache and NOT call fetch
      const body2 = {
        messages: [{ role: "user", content: longContent }],
      };
      const res2 = await compressWithHeadroom(body2, {
        enabled: true,
        url: "http://localhost:8787",
        model: "gpt-4o",
        format: "openai",
        blockCacheEnabled: true,
      });
      expect(res2).not.toBeNull();
      expect(res2.blockCacheHits).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body2.messages[0].content).toBe(compressedContent);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("serves non-streaming requests from Full Response Cache with 0 upstream calls on cache HIT", async () => {
    executeMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({
          id: "chatcmpl-test-1",
          object: "chat.completion",
          created: 1700000000,
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello from upstream!" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: {},
    });

    const makeCall = () =>
      handleChatCore({
        body: {
          model: "deepseek/deepseek-chat",
          stream: false,
          messages: [{ role: "user", content: "Say hello" }],
        },
        modelInfo: { provider: "deepseek", model: "deepseek-chat" },
        credentials: { apiKey: "sk-test" },
        responseCacheEnabled: true,
        blockCacheEnabled: false,
        rtkEnabled: false,
      });

    // 1st call: MISS -> calls upstream executor and writes to raw filesystem cache
    const first = await makeCall();
    expect(first.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const firstJson = await first.response.json();
    expect(firstJson.choices[0].message.content).toBe("Hello from upstream!");

    // 2nd call: HIT -> served from raw filesystem without calling executor
    const second = await makeCall();
    expect(second.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(second.response.headers.get("X-9Router-Cache")).toBe("HIT");
    const secondJson = await second.response.json();
    expect(secondJson.choices[0].message.content).toBe("Hello from upstream!");

    const status = getFsCacheStatus();
    expect(status.responses.entries).toBe(1);
    expect(status.responses.hits).toBe(1);
    expect(status.responses.tokensSaved).toBeGreaterThanOrEqual(35);
  });

  it("serves streaming SSE requests from Full Response Cache on second identical request", async () => {
    const ssePayload = [
      'data: {"id":"chatcmpl-stream-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Cached "},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-stream-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"stream!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    executeMock.mockResolvedValueOnce({
      response: new Response(ssePayload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: {},
    });

    const makeStreamCall = () =>
      handleChatCore({
        body: {
          model: "openai/gpt-4o-mini",
          stream: true,
          messages: [{ role: "user", content: "Stream hello" }],
        },
        modelInfo: { provider: "openai", model: "gpt-4o-mini" },
        credentials: { apiKey: "sk-test" },
        responseCacheEnabled: true,
        rtkEnabled: false,
      });

    // 1st call: streams from upstream and records SSE to raw filesystem on completion
    const first = await makeStreamCall();
    expect(first.success).toBe(true);
    const firstText = await first.response.text();
    expect(firstText).toContain("Cached ");
    expect(firstText).toContain("stream!");
    expect(executeMock).toHaveBeenCalledTimes(1);

    // 2nd call: served from raw filesystem cache with 0 upstream calls
    const second = await makeStreamCall();
    expect(second.success).toBe(true);
    expect(second.response.headers.get("X-9Router-Cache")).toBe("HIT");
    const secondText = await second.response.text();
    expect(secondText).toContain("Cached ");
    expect(secondText).toContain("stream!");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("supports selective clearing (blocks vs responses) and TTL pruning", () => {
    setBlockCacheSync("rtk", "x".repeat(300), "short");
    const key = buildResponseCacheKey({
      provider: "openai",
      model: "gpt-4o",
      sourceFormat: "openai",
      stream: false,
      body: { messages: [{ role: "user", content: "hi" }] },
    });
    setResponseCacheSync(key, {
      provider: "openai",
      model: "gpt-4o",
      sourceFormat: "openai",
      stream: false,
      bodyText: '{"ok":true}',
    });

    expect(getFsCacheStatus().blocks.entries).toBe(1);
    expect(getFsCacheStatus().responses.entries).toBe(1);

    clearFsCacheSync("blocks");
    expect(getFsCacheStatus().blocks.entries).toBe(0);
    expect(getFsCacheStatus().responses.entries).toBe(1);

    const pruned = pruneFsCacheSync({ maxSizeBytes: 1 });
    expect(pruned.removed).toBeGreaterThanOrEqual(1);
    expect(getFsCacheStatus().responses.entries).toBe(0);
  });
});
