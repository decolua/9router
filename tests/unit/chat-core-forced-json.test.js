import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("handleChatCore forced-stream JSON fallback", () => {
  let dataDir;
  let previousDataDir;

  afterEach(async () => {
    vi.doUnmock("@/lib/usageDb.js");
    vi.doUnmock("../../open-sse/executors/index.js");
    vi.resetModules();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
    previousDataDir = undefined;
  });

  it("parses ordinary JSON from forced-stream providers even with a non-JSON content-type", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-chat-core-"));
    process.env.DATA_DIR = dataDir;

    const execute = vi.fn().mockResolvedValue({
      response: new Response(JSON.stringify({
        id: "chatcmpl-test",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "pong" },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }), {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      }),
      url: "https://example.test/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      transformedBody: { model: "gpt-test", messages: [], stream: false }
    });

    vi.doMock("@/lib/usageDb.js", () => ({
      trackPendingRequest: vi.fn(),
      appendRequestLog: vi.fn().mockResolvedValue(undefined),
      saveRequestDetail: vi.fn().mockResolvedValue(undefined),
      saveRequestUsage: vi.fn().mockResolvedValue(undefined)
    }));
    vi.doMock("../../open-sse/executors/index.js", () => ({
      getExecutor: () => ({
        noAuth: true,
        execute
      })
    }));

    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    const result = await handleChatCore({
      body: {
        model: "gpt-test",
        messages: [{ role: "user", content: "ping" }],
        stream: false
      },
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "test-key" },
      log: null,
      connectionId: "conn-test",
      apiKey: "router-key"
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].stream).toBe(true);
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    await expect(result.response.json()).resolves.toMatchObject({
      choices: [{
        message: { role: "assistant", content: "pong" },
        finish_reason: "stop"
      }]
    });
  });
});
