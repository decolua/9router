import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateChatGptWebImageHttp } from "../../open-sse/executors/chatgpt-web/imageGenHttp.js";

// Mock sentinel module
vi.mock("../../open-sse/executors/chatgpt-web/sentinel.js", () => ({
  SENTINEL_HEADERS: {},
  fetchSentinelHeaders: async () => ({ "openai-sentinel-proof-token": "mock-proof" }),
}));

describe("ChatGPT Web Image Generation (HTTP)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should not treat file_upload as a valid fileId and should poll until real fileId arrives", { timeout: 20000 }, async () => {
    let conversationPollCount = 0;
    const mockImageB64 = Buffer.from("fake-png-data").toString("base64");

    globalThis.fetch = vi.fn(async (url, opts) => {
      const urlStr = String(url);

      // 1. Prepare endpoint
      if (urlStr.includes("/backend-api/f/conversation/prepare")) {
        return new Response(JSON.stringify({ conduit_token: "mock-conduit-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 2. Initial conversation SSE stream containing file-service://file_upload placeholder
      if (urlStr.includes("/backend-api/f/conversation") && !urlStr.includes("/prepare")) {
        const streamText = `data: {"conversation_id": "12345678-1234-1234-1234-123456789abc", "message": {"content": {"parts": ["file-service://file_upload"]}}}\n\n`;
        return new Response(streamText, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      // 3. Conversation document polling
      if (urlStr.includes("/backend-api/conversation/12345678-1234-1234-1234-123456789abc")) {
        conversationPollCount++;
        if (conversationPollCount === 1) {
          // Still generating, only has file_upload placeholder
          return new Response(
            JSON.stringify({
              mapping: {
                node1: {
                  message: {
                    content: { parts: ["Thinking... file-service://file_upload"] },
                  },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        // Second poll: real file-service://file-abcdef123456 ready
        return new Response(
          JSON.stringify({
            mapping: {
              node2: {
                message: {
                  author: { role: "tool" },
                  content: {
                    content_type: "multimodal_text",
                    parts: [
                      {
                        content_type: "image_asset_pointer",
                        asset_pointer: "file-service://file-abcdef1234567890",
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 4. File download URL lookup
      if (urlStr.includes("/backend-api/files/file-abcdef1234567890/download")) {
        return new Response(
          JSON.stringify({
            download_url: "https://chatgpt.com/backend-api/estuary/content?id=file-abcdef1234567890&sig=mock",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 5. Binary download from estuary endpoint (requires auth & cookie)
      if (urlStr.includes("/backend-api/estuary/content")) {
        expect(opts?.headers?.["User-Agent"]).toBe("Test-Agent/1.0");
        expect(opts?.headers?.["Authorization"]).toBe("Bearer mock-access-token");
        expect(opts?.headers?.["Cookie"]).toBe("session=xyz");
        return new Response(Buffer.from("fake-png-data"), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }

      // Reject file_upload download if erroneously requested
      if (urlStr.includes("/backend-api/files/file_upload/download")) {
        return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
      }

      return new Response("Not found", { status: 404 });
    });

    const result = await generateChatGptWebImageHttp({
      baseUrl: "https://chatgpt.com",
      accessToken: "mock-access-token",
      cookie: "session=xyz",
      userAgent: "Test-Agent/1.0",
      prompt: "A beautiful sunset",
    });

    expect(result).toBeDefined();
    expect(result.b64).toBe(mockImageB64);
    expect(result.mime).toBe("image/png");
    expect(conversationPollCount).toBe(2);
  });

  it("should support direct download_url present in conversation document", { timeout: 20000 }, async () => {
    const mockImageB64 = Buffer.from("direct-png-data").toString("base64");

    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);

      if (urlStr.includes("/backend-api/f/conversation/prepare")) {
        return new Response(JSON.stringify({ conduit_token: "mock-conduit-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("/backend-api/f/conversation") && !urlStr.includes("/prepare")) {
        return new Response(`data: {"conversation_id": "87654321-4321-4321-4321-cba987654321"}\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      if (urlStr.includes("/backend-api/conversation/87654321-4321-4321-4321-cba987654321")) {
        return new Response(
          JSON.stringify({
            attachments: [
              {
                download_url: "https://files.oaiusercontent.com/direct-file?token=mock",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("files.oaiusercontent.com/direct-file")) {
        return new Response(Buffer.from("direct-png-data"), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }

      return new Response("Not found", { status: 404 });
    });

    const result = await generateChatGptWebImageHttp({
      baseUrl: "https://chatgpt.com",
      accessToken: "mock-access-token",
      cookie: "session=xyz",
      userAgent: "Test-Agent/1.0",
      prompt: "A cute cat",
    });

    expect(result).toBeDefined();
    expect(result.b64).toBe(mockImageB64);
    expect(result.mime).toBe("image/png");
  });
});
