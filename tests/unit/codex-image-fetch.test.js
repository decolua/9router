/**
 * Codex executor: verify remote image URLs are fetched and inlined as
 * base64 data URIs BEFORE the request body reaches the upstream API.
 *
 * Covers bug #575:
 *  - prefetchImages must await async image fetches
 *  - execute() must run prefetchImages before super.execute so the body
 *    sent to upstream contains base64 data, not remote URLs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("stream", async () => await import("node:stream"));
vi.mock("/workspaces/9router/.claude/worktrees/canonical-status-phase1/stream", async () => await import("node:stream"));

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

const IMAGE_1MB_BYTES = 1024 * 1024;
const REMOTE_URL = "https://example.com/big.jpg";
const DATA_URI = "data:image/png;base64,iVBORw0KGgo=";

function makeImageBuffer(sizeBytes) {
  const buf = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) buf[i] = i & 0xff;
  return buf.buffer;
}

function mockImageFetch(sizeBytes, mimeType = "image/jpeg") {
  return {
    ok: true,
    headers: { get: (k) => (k === "Content-Type" ? mimeType : null) },
    arrayBuffer: async () => makeImageBuffer(sizeBytes),
  };
}

describe("CodexExecutor image handling", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches 1MB remote image and inlines it as base64 data URI", async () => {
    global.fetch = vi.fn(async () => mockImageFetch(IMAGE_1MB_BYTES));

    const executor = new CodexExecutor();
    const body = {
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "describe this" },
            { type: "image_url", image_url: { url: REMOTE_URL, detail: "high" } },
          ],
        },
      ],
    };

    await executor.prefetchImages(body);

    const imgBlock = body.input[0].content.find((c) => c.type === "input_image");
    expect(imgBlock, "input_image block must be present after prefetch").toBeDefined();
    expect(imgBlock.image_url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(imgBlock.detail).toBe("high");

    const base64Payload = imgBlock.image_url.split(",")[1];
    const decodedLen = Buffer.from(base64Payload, "base64").length;
    expect(decodedLen).toBe(IMAGE_1MB_BYTES);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes through existing data URIs without calling fetch", async () => {
    global.fetch = vi.fn();

    const executor = new CodexExecutor();
    const body = {
      input: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: DATA_URI } }],
        },
      ],
    };

    await executor.prefetchImages(body);

    const imgBlock = body.input[0].content.find((c) => c.type === "input_image");
    expect(imgBlock.image_url).toBe(DATA_URI);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("falls back to original URL when remote fetch fails", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network down"); });

    const executor = new CodexExecutor();
    const body = {
      input: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: REMOTE_URL } }],
        },
      ],
    };

    await executor.prefetchImages(body);

    const imgBlock = body.input[0].content.find((c) => c.type === "input_image");
    expect(imgBlock.image_url).toBe(REMOTE_URL);
  });

  it("execute() prefetches images before sending to upstream", async () => {
    global.fetch = vi.fn(async () => mockImageFetch(IMAGE_1MB_BYTES));

    let capturedBodyString = null;
    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url, init) => {
      capturedBodyString = init.body;
      return { ok: true, status: 200, headers: new Map() };
    });

    const executor = new CodexExecutor();
    const body = {
      input: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: REMOTE_URL } }],
        },
      ],
    };

    await executor.execute({
      model: "gpt-5.3-codex",
      body,
      stream: true,
      credentials: { accessToken: "test" },
    });

    expect(capturedBodyString).toBeTypeOf("string");
    expect(capturedBodyString).not.toBe("{}");
    const parsed = JSON.parse(capturedBodyString);
    const imgBlock = parsed.input[0].content.find((c) => c.type === "input_image");
    expect(imgBlock.image_url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});
