/**
 * Unit tests for the /v1/images/edits multipart parser.
 *
 * Covers (part of #5190):
 *  - prompt is required
 *  - at least one image file is required
 *  - image File/Blob is converted to a data URI on body.image
 *  - optional mask File is converted to body.mask
 *  - OpenAI scalar fields (model, size, n, response_format) pass through
 */

import { describe, it, expect, vi } from "vitest";
import { parseImageEditsBody } from "../../open-sse/handlers/imageEdits.js";

vi.mock("@/sse/handlers/imageGeneration.js", () => ({
  handleImageGeneration: vi.fn(async (req) => {
    const body = await req.json();
    return new Response(JSON.stringify({ received: body }), { status: 200 });
  }),
}));

import { POST } from "../../src/app/api/v1/images/edits/route.js";

function pngFile(name = "ref.png") {
  // Minimal PNG header bytes; content does not matter for the parser.
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}

describe("parseImageEditsBody", () => {
  it("rejects a form without prompt", async () => {
    const form = new FormData();
    form.append("image", pngFile());
    const result = await parseImageEditsBody(form);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/prompt/i);
  });

  it("rejects a form without an image", async () => {
    const form = new FormData();
    form.append("prompt", "make it sunset");
    const result = await parseImageEditsBody(form);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/image/i);
  });

  it("converts the image file to a data URI and passes scalars through", async () => {
    const form = new FormData();
    form.append("prompt", "make it sunset");
    form.append("image", pngFile());
    form.append("model", "openai/gpt-image-1");
    form.append("size", "1024x1024");
    const result = await parseImageEditsBody(form);
    expect(result.ok).toBe(true);
    expect(result.body.prompt).toBe("make it sunset");
    expect(result.body.model).toBe("openai/gpt-image-1");
    expect(result.body.size).toBe("1024x1024");
    expect(result.body.image).toMatch(/^data:image\/png;base64,/);
  });

  it("converts an optional mask file to body.mask", async () => {
    const form = new FormData();
    form.append("prompt", "edit");
    form.append("image", pngFile());
    form.append("mask", pngFile("mask.png"));
    const result = await parseImageEditsBody(form);
    expect(result.ok).toBe(true);
    expect(result.body.mask).toMatch(/^data:image\/png;base64,/);
  });
});

describe("POST /v1/images/edits", () => {
  it("returns 400 when the image is missing", async () => {
    const form = new FormData();
    form.append("prompt", "edit");
    form.append("model", "openai/gpt-image-1");
    const res = await POST(new Request("http://localhost/v1/images/edits", { method: "POST", body: form }));
    expect(res.status).toBe(400);
  });

  it("forwards the parsed body as JSON to the generations pipeline", async () => {
    const form = new FormData();
    form.append("prompt", "make it sunset");
    form.append("image", pngFile());
    form.append("model", "openai/gpt-image-1");
    const res = await POST(new Request("http://localhost/v1/images/edits", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.received.prompt).toBe("make it sunset");
    expect(payload.received.model).toBe("openai/gpt-image-1");
    expect(payload.received.image).toMatch(/^data:image\/png;base64,/);
  });
});
