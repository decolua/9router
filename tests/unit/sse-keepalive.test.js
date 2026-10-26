/**
 * Regression for #4901: a silent upstream (cold start) must not let a proxy close
 * the idle SSE response. The stream emits ": ping" comments until the first byte.
 */
import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DATA_LINES = [
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n`,
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n`,
  "data: [DONE]\n",
];

async function run({ sourceFormat, keepAliveMs, silentMs }) {
  const ts = createPassthroughStreamWithLogger(
    "test-provider", null, "test-model", null, {}, null, null, null, sourceFormat, keepAliveMs
  );

  const reader = ts.readable.getReader();
  const decoder = new TextDecoder();
  let out = "";
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  })();

  await sleep(silentMs);

  const writer = ts.writable.getWriter();
  for (const line of DATA_LINES) await writer.write(enc.encode(line));
  await writer.close();
  await pump;
  return out;
}

describe("SSE keep-alive (#4901)", () => {
  it("emits comment heartbeats while the upstream is silent", async () => {
    const out = await run({ sourceFormat: FORMATS.OPENAI, keepAliveMs: 20, silentMs: 90 });
    expect(out).toContain(": ping");
    expect(out).toContain("hi");
  });

  it("stops sending heartbeats once data flowed", async () => {
    const out = await run({ sourceFormat: FORMATS.OPENAI, keepAliveMs: 20, silentMs: 0 });
    expect(out).not.toContain(": ping");
  });

  it("never injects a comment into an NDJSON stream", async () => {
    const out = await run({ sourceFormat: FORMATS.OLLAMA, keepAliveMs: 20, silentMs: 90 });
    expect(out).not.toContain(": ping");
  });

  it("can be disabled with keepAliveMs: 0", async () => {
    const out = await run({ sourceFormat: FORMATS.OPENAI, keepAliveMs: 0, silentMs: 90 });
    expect(out).not.toContain(": ping");
  });
});
