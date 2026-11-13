import { describe, expect, it, vi } from "vitest";

// sever the DB import chain (usageDb -> @/lib/db/*) — not under test
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.js";
import { canonicalizeUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
import { formatDoneLine } from "../../open-sse/handlers/chatCore/requestDetail.js";

const encoder = new TextEncoder();

// A provider that follows the OpenAI streaming convention: the chunk that
// carries finish_reason has NO usage, and the usage arrives in a separate
// trailing chunk. That is what `stream_options: {include_usage: true}` asks
// for, and what every OpenAI-compatible provider does.
const providerUsage = {
  prompt_tokens: 1500,
  completion_tokens: 20,
  total_tokens: 1520,
  prompt_tokens_details: { cached_tokens: 1200 },
};

const providerSSE = [
  {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: { role: "assistant", content: "hi" } }],
  },
  {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  },
  {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [],
    usage: providerUsage,
  },
]
  .map((o) => `data: ${JSON.stringify(o)}\n\n`)
  .join("") + "data: [DONE]\n\n";

// A request body whose size implies far more input than the provider actually
// consumed — the provider truncated the input to its context window. The
// body-size estimate is therefore larger than the provider's real number,
// which is exactly the case where the estimate must not win.
const body = {
  model: "m",
  messages: [{ role: "user", content: "x".repeat(40_000) }],
};
const bodyEstimate = Math.ceil(JSON.stringify(body).length / 4) + 2000;

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function source(sse) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
}

// openai -> openai provider: no format conversion, so the stream runs in
// passthrough mode (needsTranslation() is false for identical formats).
async function runPassthrough(sse, requestBody = body) {
  let recorded = null;
  const out = source(sse).pipeThrough(
    createPassthroughStreamWithLogger("openai", null, "m", null, requestBody, (_content, usage) => {
      recorded = usage;
    }),
  );
  const text = await drain(out);
  return { recorded, text };
}

// openai provider -> claude client: the provider stream is translated, so the
// stream runs in translate mode. NOTE the argument order: the first format is
// the incoming (provider) format, the second the outgoing (client) format.
async function runTranslate(sse, requestBody = body) {
  let recorded = null;
  const out = source(sse).pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "openai",
      null,
      null,
      "m",
      null,
      requestBody,
      (_content, usage) => {
        recorded = usage;
      },
    ),
  );
  const text = await drain(out);
  return { recorded, text };
}

describe("estimated usage must never outrank the provider's reported usage", () => {
  it("keeps the request-body estimate above the provider's number (precondition)", () => {
    // Guards the premise of the tests below: the estimate is the larger of
    // the two, so a max-merge would pick the wrong one.
    expect(bodyEstimate).toBeGreaterThan(providerUsage.prompt_tokens);
  });

  it("records the provider's prompt tokens (passthrough mode)", async () => {
    const { recorded } = await runPassthrough(providerSSE);
    expect(recorded.prompt_tokens).toBe(1500);
    expect(recorded.completion_tokens).toBe(20);
    expect(recorded.cached_tokens).toBe(1200);
  });

  it("records the provider's prompt tokens (translate mode)", async () => {
    const { recorded } = await runTranslate(providerSSE);
    expect(recorded.prompt_tokens).toBe(1500);
    expect(recorded.completion_tokens).toBe(20);
    expect(recorded.cached_tokens).toBe(1200);
    // The estimate must not linger in the accumulator next to the real
    // usage — it is written in the client's input_tokens field, which would
    // otherwise be indistinguishable from a provider-reported count.
    expect(recorded.input_tokens).toBeUndefined();
    expect(recorded.estimated).toBeUndefined();
  });

  it("falls back to the estimate when the provider reports no usage at all", async () => {
    // No trailing usage chunk: the estimate is all we have, and it must be
    // used — but flagged as an estimate, not presented as a measurement.
    const noUsageSSE = [
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "m",
        choices: [{ index: 0, delta: { role: "assistant", content: "hi" } }],
      },
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ]
      .map((o) => `data: ${JSON.stringify(o)}\n\n`)
      .join("") + "data: [DONE]\n\n";

    const { recorded } = await runPassthrough(noUsageSSE);
    expect(recorded.prompt_tokens).toBe(bodyEstimate);
    expect(recorded.estimated).toBe(true);
  });

  it("stores the provider's prompt tokens (canonical form used for usageHistory)", async () => {
    const { recorded } = await runPassthrough(providerSSE);
    const stored = canonicalizeUsage(recorded);
    expect(stored.prompt_tokens).toBe(1500);
    expect(stored.cached_tokens).toBe(1200);
  });

  it("still forwards the provider's usage chunk to the client", async () => {
    const { text } = await runPassthrough(providerSSE);
    expect(text).toContain('"prompt_tokens":1500');
  });
});

describe("mergeUsage: an estimate never overrides an authoritative value", () => {
  it("prefers the authoritative usage over a larger estimate", () => {
    const estimate = { prompt_tokens: 4502424, completion_tokens: 1024, estimated: true };
    const authoritative = { prompt_tokens: 151674, completion_tokens: 1024, cached_tokens: 150144 };
    const merged = mergeUsage(estimate, authoritative);
    expect(merged.prompt_tokens).toBe(151674);
    expect(merged.cached_tokens).toBe(150144);
    expect(merged.completion_tokens).toBe(1024);
  });

  it("prefers the authoritative usage over a later estimate", () => {
    const authoritative = { prompt_tokens: 151674, completion_tokens: 1024, cached_tokens: 150144 };
    const estimate = { prompt_tokens: 4502424, completion_tokens: 1024, estimated: true };
    const merged = mergeUsage(authoritative, estimate);
    expect(merged.prompt_tokens).toBe(151674);
    expect(merged.cached_tokens).toBe(150144);
  });

  it("keeps the max-merge for two authoritative usages (Anthropic split events)", () => {
    // message_start carries input + cache, message_delta carries the real
    // output count — the max-merge is what stitches them together.
    const start = { prompt_tokens: 100, completion_tokens: 1, cache_read_input_tokens: 200 };
    const delta = { completion_tokens: 50 };
    const merged = mergeUsage(start, delta);
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.completion_tokens).toBe(50);
    expect(merged.cache_read_input_tokens).toBe(200);
  });
});

describe("canonicalizeUsage keeps the estimated marker", () => {
  it("preserves the estimated flag", () => {
    const out = canonicalizeUsage({ prompt_tokens: 150405, completion_tokens: 10, estimated: true });
    expect(out.estimated).toBe(true);
  });

  it("does not invent the estimated flag for an authoritative usage", () => {
    const out = canonicalizeUsage({ prompt_tokens: 1500, completion_tokens: 20, cached_tokens: 1200 });
    expect(out.estimated).toBeUndefined();
  });
});

describe("formatDoneLine marks an estimated input count", () => {
  it("flags an estimated usage so it cannot be read as a measurement", () => {
    const line = formatDoneLine({
      usage: { prompt_tokens: 150405, completion_tokens: 10, estimated: true },
      latency: { total: 120, ttft: 30 },
    });
    expect(line).toContain("estimated");
    expect(line).toContain("IN 150405");
  });

  it("leaves an authoritative usage unmarked", () => {
    const line = formatDoneLine({
      usage: { prompt_tokens: 1500, completion_tokens: 20, cached_tokens: 1200 },
      latency: { total: 120, ttft: 30 },
    });
    expect(line).not.toContain("estimated");
    expect(line).toContain("IN 1500");
  });
});
