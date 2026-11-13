import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => executor }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest() {}, logRawRequest() {}, logTargetRequest() {}, logProviderResponse() {},
    logConvertedResponse() {}, logError() {},
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));

import { GithubExecutor } from "../../open-sse/executors/github.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const executor = new GithubExecutor();
executor.noAuth = true;
executor.execute = vi.fn();
const message = "Your input exceeds the context window of this model. Please adjust your input and try again.";

beforeEach(() => vi.clearAllMocks());

async function request({ stream = true, sourceFormat = "openai-responses", code = "invalid_request_body", text = message, upstream = null } = {}) {
  executor.execute.mockResolvedValue({
    response: upstream || new Response(JSON.stringify({ error: { code, message: text } }), {
      status: 400, headers: { "x-request-id": "upstream-id", "content-type": "application/json" },
    }),
    url: "https://api.githubcopilot.com/responses", headers: {}, transformedBody: {},
  });
  const onRequestSuccess = vi.fn();
  const result = await handleChatCore({
    body: { model: "gpt-4o", stream, input: "hi", messages: [{ role: "user", content: "hi" }] },
    modelInfo: { provider: "github", model: "gpt-4o" },
    credentials: { copilotToken: "test-token", providerSpecificData: {} },
    sourceFormatOverride: sourceFormat, connectionId: "test-connection", onRequestSuccess,
    clientRawRequest: { endpoint: "/v1/responses", headers: {}, body: {} },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { result, onRequestSuccess };
}

describe("Copilot context overflow for Responses clients", () => {
  it("keeps a structured HTTP error until account and combo selection are finished", async () => {
    const { result, onRequestSuccess } = await request();
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.code).toBe("context_length_exceeded");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("retains HTTP 400 and the context code for non-streaming Responses", async () => {
    const { result } = await request({ stream: false });
    expect(result.success).toBe(false);
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.code).toBe("context_length_exceeded");
  });

  it("retains HTTP errors for streaming Chat Completions clients", async () => {
    const { result } = await request({ sourceFormat: "openai" });
    expect(result.response.status).toBe(400);
    expect((await result.response.json()).error.code).toBe("context_length_exceeded");
  });

  it("does not turn unrelated bad requests into Responses streams", async () => {
    const { result } = await request({ text: "Missing required field input" });
    expect(result.response.status).toBe(400);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    expect((await result.response.json()).error.code).not.toBe("context_length_exceeded");
  });

  it("delivers successful text before the upstream stream finishes", async () => {
    let controller;
    const upstream = new Response(new ReadableStream({
      start(value) {
        controller = value;
        value.enqueue(new TextEncoder().encode('data: {"id":"chatcmpl-test","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n'));
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const { result } = await request({ upstream });
    expect(result.success).toBe(true);
    const reader = result.response.body.getReader();
    let timer;
    try {
      const readText = async () => {
        let text = "";
        while (!text.includes("hello")) {
          const { value, done } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
        return text;
      };
      const text = await Promise.race([
        readText(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("success stream was buffered")), 2000); }),
      ]);
      expect(text).toContain("hello");
      expect(text).not.toContain("response.failed");
    } finally {
      clearTimeout(timer);
      controller.close();
      while (!(await reader.read()).done) { /* drain the normal terminal events */ }
    }
  });
});
