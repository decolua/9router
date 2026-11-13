/**
 * Regression for #5363: `?response_format=binary` must label raw image bytes
 * with the Content-Type of the actual bytes (magic-byte sniff), not the
 * requested/default output_format. Cloudflare FLUX/Leonardo return JPEG while
 * the old code always declared image/png.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/handlers/imageProviders/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  const fakeExecutorAdapter = {
    useExecutor: true,
    executeViaExecutor: async (_model, body) => ({ created: 1, data: [{ b64_json: body.__b64 }] }),
    normalize: (responseBody) => responseBody,
  };
  return {
    ...actual,
    getImageAdapter: (provider) => (provider === "fake-exec" ? fakeExecutorAdapter : actual.getImageAdapter(provider)),
  };
});

const { handleImageGenerationCore } = await import("../../open-sse/handlers/imageGenerationCore.js");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const UNKNOWN = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);

const originalFetch = global.fetch;

function cloudflareJson(buf) {
  return new Response(JSON.stringify({ result: { image: buf.toString("base64") }, success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function runCloudflare(model, upstream, body = {}) {
  global.fetch.mockResolvedValueOnce(upstream);
  return handleImageGenerationCore({
    body: { prompt: "a red apple", ...body },
    modelInfo: { provider: "cloudflare-ai", model },
    credentials: { apiKey: "cf-token", providerSpecificData: { accountId: "cf-account" } },
    binaryOutput: true,
    log: null,
  });
}

async function expectBinary(result, { mime, filename, bytes }) {
  expect(result.success).toBe(true);
  expect(result.response.headers.get("Content-Type")).toBe(mime);
  expect(result.response.headers.get("Content-Disposition")).toBe(`inline; filename="${filename}"`);
  const out = Buffer.from(await result.response.arrayBuffer());
  expect(out.equals(bytes)).toBe(true);
}

describe("binary image output Content-Type (#5363)", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("labels Cloudflare FLUX JPEG bytes (JSON result.image) as image/jpeg", async () => {
    const result = await runCloudflare("@cf/black-forest-labs/flux-1-schnell", cloudflareJson(JPEG));
    await expectBinary(result, { mime: "image/jpeg", filename: "image.jpg", bytes: JPEG });
  });

  it("labels Leonardo raw image/jpeg upstream bytes as image/jpeg", async () => {
    const upstream = new Response(JPEG, { status: 200, headers: { "Content-Type": "image/jpeg" } });
    const result = await runCloudflare("@cf/leonardo/phoenix-1.0", upstream);
    await expectBinary(result, { mime: "image/jpeg", filename: "image.jpg", bytes: JPEG });
  });

  it("keeps image/png for SDXL PNG bytes", async () => {
    const upstream = new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    const result = await runCloudflare("@cf/stabilityai/stable-diffusion-xl-base-1.0", upstream);
    await expectBinary(result, { mime: "image/png", filename: "image.png", bytes: PNG });
  });

  it("trusts the bytes over a mismatching output_format", async () => {
    const upstream = new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    const result = await runCloudflare("@cf/stabilityai/stable-diffusion-xl-base-1.0", upstream, { output_format: "jpeg" });
    await expectBinary(result, { mime: "image/png", filename: "image.png", bytes: PNG });
  });

  it("labels WebP bytes as image/webp", async () => {
    const result = await runCloudflare("@cf/black-forest-labs/flux-2-dev", cloudflareJson(WEBP));
    await expectBinary(result, { mime: "image/webp", filename: "image.webp", bytes: WEBP });
  });

  it("falls back to output_format when bytes are unrecognized", async () => {
    const result = await runCloudflare("@cf/black-forest-labs/flux-1-schnell", cloudflareJson(UNKNOWN), { output_format: "jpeg" });
    await expectBinary(result, { mime: "image/jpeg", filename: "image.jpg", bytes: UNKNOWN });
  });

  it("falls back to image/png when bytes are unrecognized and no output_format", async () => {
    const result = await runCloudflare("@cf/black-forest-labs/flux-1-schnell", cloudflareJson(UNKNOWN));
    await expectBinary(result, { mime: "image/png", filename: "image.png", bytes: UNKNOWN });
  });

  it("sniffs bytes on the executor-delegating adapter path too", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "a red apple", __b64: JPEG.toString("base64") },
      modelInfo: { provider: "fake-exec", model: "m" },
      credentials: {},
      binaryOutput: true,
      log: null,
    });
    await expectBinary(result, { mime: "image/jpeg", filename: "image.jpg", bytes: JPEG });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
