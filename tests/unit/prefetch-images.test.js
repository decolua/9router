import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/translator/concerns/image.js", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    fetchImageAsBase64: vi.fn(async () => ({ url: "data:image/png;base64,QUJD", mimeType: "image/png" })),
  };
});

import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

beforeEach(() => { fetchImageAsBase64.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("prefetchRemoteImages", () => {
  it("no-op for targets that accept remote URLs (openai)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(n).toBe(0);
    expect(body.messages[0].content[0].image_url.url).toBe("https://x/a.png");
  });

  it("openai source -> ollama target: converts remote URL to base64", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/a.png" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("skips data URI (already inline)", async () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xx" } }] }] };
    const n = await prefetchRemoteImages(body, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(n).toBe(0);
    expect(fetchImageAsBase64).not.toHaveBeenCalled();
  });

  it("gemini source -> gemini target: fileData URL -> inlineData base64", async () => {
    const body = { contents: [{ role: "user", parts: [
      { fileData: { mimeType: "image/png", fileUri: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.GEMINI, FORMATS.GEMINI);
    expect(n).toBe(1);
    expect(body.contents[0].parts[0].inlineData).toBeTruthy();
    expect(body.contents[0].parts[0].fileData).toBeUndefined();
  });

  it("claude source -> kiro target: source.url -> base64", async () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: "https://x/a.png" } },
    ] }] };
    const n = await prefetchRemoteImages(body, FORMATS.CLAUDE, FORMATS.KIRO);
    expect(n).toBe(1);
    expect(body.messages[0].content[0].source.type).toBe("base64");
  });
});
