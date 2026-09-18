/**
 * HuggingFace image generation — end-to-end through the real core handler.
 *
 * The registry/adapter tests pin the URL and payload in isolation. These tests
 * drive `handleImageGenerationCore` — the same function the `/v1/images/generations`
 * route calls — so the whole seam is exercised: adapter selection, buildUrl /
 * buildBody / buildHeaders, the fetch call, and the binary response parse.
 *
 * The mocked `fetch` asserts on the exact request the router would receive, which
 * is the strongest check available without burning live Inference Providers credits
 * (the router bills before validating the payload, so a live probe can only prove
 * the path exists, never that the body is right).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;
const CREDS = { apiKey: "hf_test_token" };

// A 1x1 transparent PNG — enough to prove the bytes survive the round trip.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function mockBinaryResponse() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => PNG_1X1.buffer.slice(PNG_1X1.byteOffset, PNG_1X1.byteOffset + PNG_1X1.byteLength),
  };
}

async function generate(body, model) {
  return handleImageGenerationCore({
    body,
    modelInfo: { provider: "huggingface", model },
    credentials: CREDS,
    log: null,
  });
}

describe("HuggingFace image generation — end to end", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(mockBinaryResponse());
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts a text-to-image request to the fal-ai router path", async () => {
    const result = await generate({ prompt: "a lighthouse at dusk" }, "black-forest-labs/FLUX.1-schnell");

    expect(result.success).toBe(true);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://router.huggingface.co/fal-ai/fal-ai/flux/schnell");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ inputs: "a lighthouse at dusk" });
  });

  it("authenticates with the connection's API key", async () => {
    await generate({ prompt: "x" }, "black-forest-labs/FLUX.1-schnell");

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer hf_test_token");
  });

  it("never touches the dead api-inference host", async () => {
    await generate({ prompt: "x" }, "black-forest-labs/FLUX.1-schnell");

    expect(global.fetch.mock.calls[0][0]).not.toContain("api-inference.huggingface.co");
  });

  it("posts an image-to-image request with the source image in inputs", async () => {
    const result = await generate(
      { prompt: "make it snow", image: "data:image/png;base64,AAAB" },
      "Qwen/Qwen-Image-Edit"
    );

    expect(result.success).toBe(true);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://router.huggingface.co/fal-ai/fal-ai/qwen-image-edit");
    // The router takes raw base64 in inputs and the prompt under parameters —
    // the data-URL prefix must be stripped, not forwarded.
    expect(JSON.parse(init.body)).toEqual({
      inputs: "AAAB",
      parameters: { prompt: "make it snow" },
    });
  });

  it("rejects an image-to-image model that was given no source image", async () => {
    const result = await generate({ prompt: "make it snow" }, "Qwen/Qwen-Image-Edit");

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/requires a source image/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a model with no router mapping before calling upstream", async () => {
    const result = await generate({ prompt: "x" }, "some-org/unmapped-model");

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/no HuggingFace router mapping/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the generated image as base64 to the client", async () => {
    const result = await generate({ prompt: "x" }, "black-forest-labs/FLUX.1-schnell");

    const payload = await result.response.json();
    expect(payload.data[0].b64_json).toBe(PNG_1X1.toString("base64"));
  });

  it("routes a self-hosted connection to its own endpoint", async () => {
    await handleImageGenerationCore({
      body: { prompt: "x" },
      modelInfo: { provider: "huggingface", model: "my-org/my-tgi-model" },
      credentials: { apiKey: "k", providerSpecificData: { baseUrl: "https://tgi.internal" } },
      log: null,
    });

    expect(global.fetch.mock.calls[0][0]).toBe("https://tgi.internal/my-org/my-tgi-model");
  });

  it("surfaces an upstream error instead of a broken image", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ error: "You have depleted your monthly included credits." }),
      json: async () => ({ error: "You have depleted your monthly included credits." }),
    });

    const result = await generate({ prompt: "x" }, "black-forest-labs/FLUX.1-schnell");

    expect(result.success).toBe(false);
    expect(result.status).toBe(402);
  });
});
