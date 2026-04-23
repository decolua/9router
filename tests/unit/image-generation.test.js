/**
 * Unit tests for image generation handler
 *
 * Covers:
 *  - OpenAI-compatible format (openai, minimax, openrouter)
 *  - Gemini format (generateContent API)
 *  - Provider-specific formats (nanobanana, sdwebui)
 *  - Response normalization to OpenAI format
 *  - Error handling (missing prompt, invalid model)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("stream", async () => await import("node:stream"));
vi.mock("/workspaces/9router/.claude/worktrees/canonical-status-phase1/stream", async () => await import("node:stream"));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;

describe("handleImageGenerationCore", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("validates required prompt field", async () => {
    const result = await handleImageGenerationCore({
      body: { model: "openai/dall-e-3" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("Missing required field: prompt");
  });

  it("rejects unsupported provider", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "unknown-provider", model: "test" },
      credentials: null,
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("does not support image generation");
  });

  it("generates image with OpenAI format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/image.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A cute cat", n: 1, size: "1024x1024" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
        body: expect.stringContaining('"prompt":"A cute cat"'),
      })
    );

    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(1);
    expect(responseBody.data[0].url).toBe("https://example.com/image.png");
  });

  it("generates image with Gemini format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Generated image" },
                  { inlineData: { data: "base64imagedata" } },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A sunset" },
      modelInfo: { provider: "gemini", model: "gemini-image-preview" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"responseModalities":["TEXT","IMAGE"]'),
      })
    );

    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(1);
    expect(responseBody.data[0].b64_json).toBe("base64imagedata");
  });

  it("generates image with Minimax format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/minimax.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain", size: "1024x1024" },
      modelInfo: { provider: "minimax", model: "minimax-image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.minimaxi.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
  });

  it("generates image with NanoBanana format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ image: "base64nanobanana" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A robot", n: 2, size: "1024x1792" },
      modelInfo: { provider: "nanobanana", model: "nanobanana-flash" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.type).toBe("TEXTTOIAMGE");
    expect(requestBody.numImages).toBe(2);
    expect(requestBody.image_size).toBe("9:16");

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64nanobanana");
  });

  it("generates image with SD WebUI format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ images: ["base64sdwebui1", "base64sdwebui2"] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A forest", size: "768x768", n: 2 },
      modelInfo: { provider: "sdwebui", model: "sdxl-base-1.0" },
      credentials: null,
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.width).toBe(768);
    expect(requestBody.height).toBe(768);
    expect(requestBody.batch_size).toBe(2);

    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(2);
  });

  it("handles OpenRouter with HTTP-Referer header", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/or.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A city" },
      modelInfo: { provider: "openrouter", model: "openai/dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images/generations",
      expect.objectContaining({
        headers: expect.objectContaining({
          "HTTP-Referer": "https://endpoint-proxy.local",
          "X-Title": "Endpoint Proxy",
        }),
      })
    );
  });

  it("handles HuggingFace binary response", async () => {
    const imageBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    global.fetch.mockResolvedValueOnce(
      new Response(imageBuffer, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A tree" },
      modelInfo: { provider: "huggingface", model: "black-forest-labs/FLUX.1-schnell" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBeTruthy();
  });

  it("handles provider error responses", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("Rate limit exceeded");
  });

  it("handles network errors", async () => {
    global.fetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("Network timeout");
  });

  it("calls onRequestSuccess callback on success", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/success.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const onRequestSuccess = vi.fn();

    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
      onRequestSuccess,
    });

    expect(result.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });
});
