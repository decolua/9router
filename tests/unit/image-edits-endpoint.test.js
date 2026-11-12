import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  handleImageGeneration: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/sse/handlers/imageGeneration.js", () => ({
  handleImageGeneration: mocks.handleImageGeneration,
}));

const { handleImageEdit } = await import("../../src/sse/handlers/imageEdits.js");

const URL_EDITS = "http://localhost/v1/images/edits";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const png = (name = "a.png") => new File([PNG], name, { type: "image/png" });
const multipart = (entries, headers = {}) => {
  const form = new FormData();
  entries.forEach(([key, value]) => form.append(key, value));
  return new Request(URL_EDITS, { method: "POST", body: form, headers });
};
const json = (body) => new Request(URL_EDITS, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const forwarded = () => mocks.handleImageGeneration.mock.calls[0][0];
const base = [["model", "cx/gpt-image-2"], ["prompt", "make it blue"]];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({});
  mocks.handleImageGeneration.mockResolvedValue(new Response("{}"));
});

describe("POST /v1/images/edits", () => {
  it("turns a multipart upload into a generations request", async () => {
    await handleImageEdit(multipart([...base, ["n", "1"], ["size", "1024x1024"], ["image", png()]], { authorization: "Bearer k" }));
    const request = forwarded();
    expect(request.url).toBe(URL_EDITS);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("authorization")).toBe("Bearer k");
    expect(await request.json()).toEqual({
      model: "cx/gpt-image-2",
      prompt: "make it blue",
      n: 1,
      size: "1024x1024",
      image: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
    });
  });

  it("sends several uploads as images[]", async () => {
    await handleImageEdit(multipart([...base, ["image[]", png("a.png")], ["image[]", new File([WEBP], "b.webp")]]));
    const body = await forwarded().json();
    expect(body.image).toBeUndefined();
    expect(body.images).toHaveLength(2);
    expect(body.images[1]).toMatch(/^data:image\/webp;base64,/);
  });

  it("ignores the claimed content type and rejects non-image bytes", async () => {
    const response = await handleImageEdit(multipart([...base, ["image", new File(["<svg onload=x>"], "a.png", { type: "image/png" })]]));
    expect(response.status).toBe(400);
    expect(mocks.handleImageGeneration).not.toHaveBeenCalled();
  });

  it("rejects a string in a multipart image field instead of fetching it", async () => {
    const response = await handleImageEdit(multipart([...base, ["image", "http://169.254.169.254/latest"]]));
    expect(response.status).toBe(400);
    expect(mocks.handleImageGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["multipart", () => multipart([...base, ["image", png()], ["mask", png("mask.png")]])],
    ["json", () => json({ prompt: "x", image: "data:image/png;base64,AA", mask: "data:image/png;base64,AA" })],
  ])("rejects a mask in %s instead of ignoring it", async (_, build) => {
    const response = await handleImageEdit(build());
    expect(response.status).toBe(400);
    expect(mocks.handleImageGeneration).not.toHaveBeenCalled();
  });

  it("requires an image", async () => {
    const response = await handleImageEdit(multipart(base));
    expect(response.status).toBe(400);
    expect(mocks.handleImageGeneration).not.toHaveBeenCalled();
  });

  it("limits the number of uploads", async () => {
    const response = await handleImageEdit(multipart([...base, ...Array.from({ length: 17 }, () => ["image[]", png()])]));
    expect(response.status).toBe(400);
  });

  it("rejects an oversized image file", async () => {
    const big = new File([PNG, new Uint8Array(25 * 1024 * 1024)], "big.png");
    const response = await handleImageEdit(multipart([...base, ["image", big]]));
    expect(response.status).toBe(413);
  });

  it("rejects an oversized request before reading it", async () => {
    const request = multipart([...base, ["image", png()]]);
    const formData = vi.spyOn(request, "formData");
    const oversized = new Proxy(request, {
      get: (target, key) => key === "headers"
        ? new Headers({ "content-length": String(101 * 1024 * 1024), "content-type": "multipart/form-data" })
        : Reflect.get(target, key).bind?.(target) ?? Reflect.get(target, key),
    });
    const response = await handleImageEdit(oversized);
    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid API key before reading the upload", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.extractApiKey.mockReturnValue(null);
    expect((await handleImageEdit(multipart([...base, ["image", png()]]))).status).toBe(401);
    mocks.extractApiKey.mockReturnValue("bad");
    mocks.isValidApiKey.mockResolvedValue(false);
    expect((await handleImageEdit(multipart([...base, ["image", png()]]))).status).toBe(401);
    expect(mocks.handleImageGeneration).not.toHaveBeenCalled();
  });

  it("accepts the OpenAI JSON shape", async () => {
    await handleImageEdit(json({ model: "m", prompt: "x", images: [{ image_url: "https://x/a.png" }, { image_url: "data:image/png;base64,AA" }] }));
    expect((await forwarded().json()).images).toEqual(["https://x/a.png", "data:image/png;base64,AA"]);
  });

  it("rejects JSON file_id references", async () => {
    expect((await handleImageEdit(json({ prompt: "x", images: [{ file_id: "f" }] }))).status).toBe(400);
  });

  it("reports malformed bodies", async () => {
    const response = await handleImageEdit(new Request(URL_EDITS, { method: "POST", body: "{", headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(400);
  });
});
