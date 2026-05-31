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
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;

describe("handleImageGenerationCore", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
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
    vi.useFakeTimers();
    global.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 200, data: { taskId: "task-123" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              successFlag: 1,
              response: { resultImageUrl: "https://example.com/nanobanana.png" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const pending = handleImageGenerationCore({
      body: { prompt: "A robot", n: 2, size: "1024x1792" },
      modelInfo: { provider: "nanobanana", model: "nanobanana-flash" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.type).toBe("TEXTTOIAMGE");
    expect(requestBody.numImages).toBe(2);
    expect(requestBody.image_size).toBe("9:16");
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.nanobananaapi.ai/api/v1/nanobanana/record-info?taskId=task-123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );

    const responseBody = await result.response.json();
    expect(responseBody.data[0].url).toBe("https://example.com/nanobanana.png");
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

  it("generates image with NVIDIA NIM artifacts response", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [{ base64: "base64nvidia", finishReason: "SUCCESS" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A neon city", width: 1344, height: 1024, seed: 7, steps: 4 },
      modelInfo: { provider: "nvidia", model: "black-forest-labs/flux.1-schnell" },
      credentials: { apiKey: "nv-token" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer nv-token",
        }),
      })
    );

    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toEqual({
      prompt: "A neon city",
      width: 1344,
      height: 1024,
      seed: 7,
      steps: 4,
    });

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64nvidia");
    expect(responseBody.data[0].finish_reason).toBe("SUCCESS");
  });

  it("sends NVIDIA FLUX.2 Klein edit input image as an array", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [{ base64: "base64nvidiaedit" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "Make the frog wear tiny glasses",
        image: "data:image/png;example_id,0",
        width: 1024,
        height: 1024,
        seed: 0,
        steps: 4,
      },
      modelInfo: { provider: "nvidia", model: "black-forest-labs/flux.2-klein-4b" },
      credentials: { apiKey: "nv-token" },
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toEqual({
      prompt: "Make the frog wear tiny glasses",
      width: 1024,
      height: 1024,
      image: ["data:image/png;example_id,0"],
      seed: 0,
      steps: 4,
    });

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64nvidiaedit");
  });

  it("omits NVIDIA FLUX.1 Dev input image in base mode", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [{ base64: "base64nvidiabase" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "A simple coffee shop interior",
        mode: "base",
        image: "data:image/png;example_id,0",
        cfg_scale: 1.1,
        width: 768,
        height: 1344,
        seed: 0,
        steps: 50,
      },
      modelInfo: { provider: "nvidia", model: "black-forest-labs/flux.1-dev" },
      credentials: { apiKey: "nv-token" },
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toEqual({
      prompt: "A simple coffee shop interior",
      mode: "base",
      width: 768,
      height: 1344,
      cfg_scale: 1.1,
      seed: 0,
      steps: 50,
    });
  });

  it("drops unsupported NVIDIA FLUX.1 Dev dimensions and cfg_scale values", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [{ base64: "base64nvidiasanitized" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "A simple coffee shop interior",
        mode: "base",
        image: "data:image/png;example_id,0",
        cfg_scale: 0,
        width: 1792,
        height: 1024,
        seed: 0,
        steps: 50,
      },
      modelInfo: { provider: "nvidia", model: "black-forest-labs/flux.1-dev" },
      credentials: { apiKey: "nv-token" },
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toEqual({
      prompt: "A simple coffee shop interior",
      mode: "base",
      seed: 0,
      steps: 50,
    });
  });

  it("sends NVIDIA FLUX.1 Dev control image as a string", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [{ base64: "base64nvidiadepth" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "A simple coffee shop interior",
        mode: "depth",
        image: "data:image/png;example_id,0",
        cfg_scale: 3.5,
        width: 1024,
        height: 1024,
        seed: 0,
        steps: 50,
      },
      modelInfo: { provider: "nvidia", model: "black-forest-labs/flux.1-dev" },
      credentials: { apiKey: "nv-token" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer nv-token",
        }),
      })
    );

    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toEqual({
      prompt: "A simple coffee shop interior",
      width: 1024,
      height: 1024,
      mode: "depth",
      image: "data:image/png;example_id,0",
      cfg_scale: 3.5,
      seed: 0,
      steps: 50,
    });

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64nvidiadepth");
  });

  it("sends NVIDIA FLUX.1 Kontext edit input image as a string with aspect ratio", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          artifacts: [{ base64: "base64nvidiakontext" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "Now the mouse is holding pizza instead",
        image: "data:image/png;example_id,0",
        aspect_ratio: "match_input_image",
        width: 1024,
        height: 1024,
        steps: 30,
        cfg_scale: 3.5,
        seed: 0,
      },
      modelInfo: { provider: "nvidia", model: "black-forest-labs/flux.1-kontext-dev" },
      credentials: { apiKey: "nv-token" },
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody).toEqual({
      prompt: "Now the mouse is holding pizza instead",
      image: "data:image/png;example_id,0",
      aspect_ratio: "match_input_image",
      cfg_scale: 3.5,
      seed: 0,
      steps: 30,
    });

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64nvidiakontext");
  });

  it("generates image with Codex gpt-5.5-image using current Codex version header", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        [
          "event: response.output_item.done",
          'data: {"item":{"type":"image_generation_call","result":"base64codeximage"}}',
          "",
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "A green square",
        size: "1024x1024",
        output_format: "png",
      },
      modelInfo: { provider: "codex", model: "gpt-5.5-image" },
      credentials: {
        accessToken: "codex-token",
        providerSpecificData: { chatgptAccountId: "account-123" },
      },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer codex-token",
          "chatgpt-account-id": "account-123",
          version: "0.129.0",
        }),
      })
    );

    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.model).toBe("gpt-5.5");
    expect(requestBody.tools).toEqual([
      { type: "image_generation", output_format: "png", size: "1024x1024" },
    ]);

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64codeximage");
  });

  it("generates image with Cloudflare Workers AI JSON response", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { image: "base64cloudflare" },
          success: true,
          errors: [],
          messages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A lighthouse", size: "1024x1536" },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/leonardo/lucid-origin" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "cf-account" },
      },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai/run/@cf/leonardo/lucid-origin",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer cf-token",
        }),
      })
    );

    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.prompt).toBe("A lighthouse");
    expect(requestBody.width).toBe(1024);
    expect(requestBody.height).toBe(1536);

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64cloudflare");
  });

  it("uses multipart form data for Cloudflare FLUX.2 models", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { image: "base64flux2" },
          success: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain lake", size: "1792x1024", steps: 4 },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/black-forest-labs/flux-2-klein-9b" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "cf-account" },
      },
      log: null,
    });

    expect(result.success).toBe(true);

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].headers).not.toHaveProperty("Content-Type");
    expect(fetchCall[1].body).toBeInstanceOf(FormData);
    expect(fetchCall[1].body.get("prompt")).toBe("A mountain lake");
    expect(fetchCall[1].body.get("width")).toBe("1792");
    expect(fetchCall[1].body.get("height")).toBe("1024");
    expect(fetchCall[1].body.get("steps")).toBe("4");
  });

  it("resolves Cloudflare img2img and inpainting URL inputs before sending", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: { image: "base64inpaint" }, success: true }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "Change to a lion",
        image: "https://example.com/source.png",
        mask_image: "https://example.com/mask.png",
        size: "512x512",
      },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/runwayml/stable-diffusion-v1-5-inpainting" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "cf-account" },
      },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenNthCalledWith(1, "https://example.com/source.png");
    expect(global.fetch).toHaveBeenNthCalledWith(2, "https://example.com/mask.png");

    const providerCall = global.fetch.mock.calls[2];
    expect(providerCall[0]).toBe("https://api.cloudflare.com/client/v4/accounts/cf-account/ai/run/@cf/runwayml/stable-diffusion-v1-5-inpainting");
    const requestBody = JSON.parse(providerCall[1].body);
    expect(requestBody.image).toEqual([1, 2, 3]);
    expect(requestBody.image_b64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(requestBody.mask).toEqual([4, 5, 6]);
    expect(requestBody.mask_image).toEqual([4, 5, 6]);
    expect(requestBody.mask_b64).toBe(Buffer.from([4, 5, 6]).toString("base64"));
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
