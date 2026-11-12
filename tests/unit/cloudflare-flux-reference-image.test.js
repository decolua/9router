import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));

import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/J8AAAAASUVORK5CYII=", "base64");
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const MODELS = [
  "@cf/black-forest-labs/flux-2-dev",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-klein-9b",
];
const credentials = { apiKey: "test-token", providerSpecificData: { accountId: "test-account" } };

function generate(body, model = MODELS[0]) {
  return handleImageGenerationCore({
    body: { prompt: "Make the reference a watercolor", ...body },
    modelInfo: { provider: "cloudflare-ai", model },
    credentials,
  });
}

function providerResponse() {
  return new Response(JSON.stringify({ result: { image: "generated-image" }, success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Decode the actual wire representation, not just the adapter's FormData object.
async function sentForm(callIndex = 0) {
  const [url, options] = fetch.mock.calls[callIndex];
  expect(url).toMatch(/^https:\/\/api\.cloudflare\.com\//);
  expect(options.headers.Authorization).toBe("Bearer test-token");
  expect(options.headers).not.toHaveProperty("Content-Type");
  const request = new Request(url, options);
  expect(request.headers.get("content-type")).toContain("multipart/form-data; boundary=");
  return request.formData();
}

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => providerResponse()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(MODELS)("Cloudflare reference image: %s", (model) => {
  it.each([
    ["data URI", DATA_URL],
    ["raw base64", PNG.toString("base64")],
    ["byte array", Array.from(PNG)],
  ])("forwards a %s as binary input_image_0", async (_name, image) => {
    const result = await generate({ image }, model);
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const form = await sentForm();
    const file = form.get("input_image_0");
    expect(file).toBeInstanceOf(Blob);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
    if (image === DATA_URL) expect(file.type).toBe("image/png");
    expect(form.get("prompt")).toBe("Make the reference a watercolor");
    expect((await result.response.json()).data[0].b64_json).toBe("generated-image");
  });
});

describe("Cloudflare FLUX.2 reference resolution", () => {
  it("fetches a public image through the guarded helper before uploading binary", async () => {
    fetch.mockResolvedValueOnce(new Response(PNG, { headers: { "Content-Type": "image/png" } }));
    const result = await generate({ image: "https://example.com/reference.png" });
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
    const file = (await sentForm(1)).get("input_image_0");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
  });

  it("rejects private-address references without fetching or generating an unconditioned image", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const result = await generate({ image: "https://internal.example/reference.png" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects failed downloads instead of silently generating without the reference", async () => {
    fetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await generate({ image: "https://example.com/missing.png" });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://example.com/missing.png");
  });

  it("rejects unsupported image input instead of discarding it", async () => {
    const result = await generate({ image: { unexpected: "shape" } });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["data URI array", [DATA_URL]],
    ["URL array", ["https://example.com/reference.png"]],
    ["mixed bytes and strings", [137, DATA_URL]],
    ["numeric string", ["137"]],
    ["negative byte", [-1]],
    ["byte overflow", [256]],
    ["fractional byte", [1.5]],
    ["null byte", [null]],
    ["boolean byte", [true]],
    ["nested byte array", [Array.from(PNG)]],
    ["sparse byte array", new Array(1)],
    ["empty byte array", []],
  ])("rejects %s before any network request", async (_name, image) => {
    const result = await generate({ image });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe("Invalid reference image");
    expect(fetch).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ["single reference in images", { images: [DATA_URL] }],
    ["multiple references in images", { images: [DATA_URL, DATA_URL] }],
    ["both image and images", { image: DATA_URL, images: [DATA_URL] }],
    ["remote image and images", { image: "https://example.com/reference.png", images: [DATA_URL] }],
    ["non-array images", { images: DATA_URL }],
  ])("rejects unsupported %s instead of dropping references", async (_name, body) => {
    fetch.mockResolvedValueOnce(new Response(PNG, { headers: { "Content-Type": "image/png" } }));
    const result = await generate(body);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe("FLUX.2 expects a single reference in image; images is not supported");
    expect(fetch).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([[null], [[]]])("allows empty images (%j) without dropping a valid single image", async (images) => {
    const result = await generate({ image: DATA_URL, images });
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const file = (await sentForm()).get("input_image_0");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
  });

  it.each([[null], [[]]])("keeps prompt-only requests with empty images (%j)", async (images) => {
    const result = await generate({ images });
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(await sentForm())).toEqual({ prompt: "Make the reference a watercolor" });
  });

  it("keeps prompt-only FLUX.2 requests and their options unchanged", async () => {
    const result = await generate({ size: "1024x768", seed: 0, guidance: 3.5 });
    expect(result.success).toBe(true);
    const form = await sentForm();
    expect(Object.fromEntries(form)).toEqual({
      prompt: "Make the reference a watercolor", width: "1024", height: "768", seed: "0", guidance: "3.5",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps the existing JSON img2img contract unchanged", async () => {
    const result = await generate({ image: DATA_URL }, "@cf/runwayml/stable-diffusion-v1-5-img2img");
    expect(result.success).toBe(true);
    const options = fetch.mock.calls[0][1];
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toMatchObject({ image: Array.from(PNG), image_b64: PNG.toString("base64") });
    expect(lookup).not.toHaveBeenCalled();
  });
});
