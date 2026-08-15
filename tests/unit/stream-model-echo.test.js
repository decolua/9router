import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-stream-echo-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createPassthroughStreamWithLogger } = await import("open-sse/utils/stream.js");

  return {
    createPassthroughStreamWithLogger,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("stream model echo", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("rewrites the upstream model echo to the client-requested name", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    // Client asked for oc/big-pickle; upstream (opencode free tier) echoes the
    // bare resolved id. The relay must return the requested name so clients
    // that trust the echo re-send a name 9router can route again.
    const body = { model: "oc/big-pickle", messages: [{ role: "user", content: "hi" }] };
    const stream = ctx.createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-1", body, null);

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const encoder = new TextEncoder();

    // Drain the readable side concurrently so writes never backpressure.
    let out = "";
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
    })();

    await writer.write(encoder.encode(
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"big-pickle","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
    ));
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
    await pump;

    expect(out).toContain('"model":"oc/big-pickle"');
    expect(out).not.toContain('"model":"big-pickle"');
    expect(out).toContain("data: [DONE]");
  });

  it("re-injects the listing prefix when the client sent a bare name", async () => {
    const ctx = await setup();
    cleanup = ctx.cleanup;

    // Client sent the bare name; 9router resolves it to opencode and the echo
    // must come back as the listing form (oc/big-pickle) so clients that
    // validate the echoed model against /v1/models don't warn and fall back.
    const body = { model: "big-pickle", messages: [{ role: "user", content: "hi" }] };
    const stream = ctx.createPassthroughStreamWithLogger("opencode", null, "big-pickle", "conn-1", body, null);

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const encoder = new TextEncoder();

    let out = "";
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
    })();

    await writer.write(encoder.encode(
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"big-pickle","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
    ));
    await writer.write(encoder.encode("data: [DONE]\n\n"));
    await writer.close();
    await pump;

    expect(out).toContain('"model":"oc/big-pickle"');
    expect(out).not.toContain('"model":"big-pickle"');
  });
});
