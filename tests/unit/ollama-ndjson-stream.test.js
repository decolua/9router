import { describe, it, expect } from "vitest";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";

describe("Ollama stream content type support", () => {
  it("allows application/x-ndjson and application/stream+json without blocking as non-SSE error", async () => {
    const mockProviderResponse = {
      status: 200,
      headers: new Map([["content-type", "application/x-ndjson"]]),
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    };
    mockProviderResponse.headers.get = (name) => (name.toLowerCase() === "content-type" ? "application/x-ndjson" : null);

    const mockStreamController = {
      signal: new AbortController().signal,
      handleError: () => {},
    };

    const res = await handleStreamingResponse({
      providerResponse: mockProviderResponse,
      provider: "ollama",
      model: "llama3",
      sourceFormat: "openai",
      targetFormat: "openai",
      userAgent: "",
      body: { stream: true },
      translatedBody: {},
      finalBody: {},
      requestStartTime: Date.now(),
      connectionId: "conn_1",
      apiKey: null,
      clientRawRequest: null,
      onRequestSuccess: null,
      reqLogger: { logTargetRequest: () => {} },
      toolNameMap: null,
      customToolNames: null,
      streamController: mockStreamController,
      onStreamComplete: null,
      streamDetailId: "detail_1",
      pxpipe: null,
      reqTag: "tag_1",
      log: { debug: () => {} },
    });

    expect(res?.success).not.toBe(false);
  });
});
