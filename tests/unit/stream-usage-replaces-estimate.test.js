// Item 4 — real upstream usage must replace an estimate, not max-merge with it.
//
// utils/stream.js injects estimateUsage() into the finish chunk when the
// provider sends no usage there, then merges the later real usage with
// mergeUsage() (field-wise Math.max). The persisted prompt_tokens therefore
// became max(estimate, real) — inflated whenever the estimate (JSON length / 4
// plus the fixed buffer) exceeded reality.
import { describe, it, expect, vi } from "vitest";
import { mergeUsage } from "../../open-sse/utils/usageTracking.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createPassthroughStreamWithLogger } = await import("../../open-sse/utils/stream.js");

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function feed(sseText, transform) {
  const input = new Blob([sseText]).stream();
  return drain(input.pipeThrough(transform));
}

const oa = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chatChunk = (delta, finish = null) => ({
  id: "chatcmpl-abcdef123456",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-x",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const body = { model: "gpt-x", messages: [{ role: "user", content: "hi" }] };

describe("mergeUsage — estimate vs real", () => {
  it("a real report replaces an estimate instead of max-merging", () => {
    const estimate = { prompt_tokens: 2016, completion_tokens: 2, total_tokens: 2018, estimated: true };
    const real = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    expect(mergeUsage(estimate, real)).toEqual(real);
  });

  it("an estimate never overwrites real usage", () => {
    const real = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    const estimate = { prompt_tokens: 2016, completion_tokens: 2, total_tokens: 2018, estimated: true };
    expect(mergeUsage(real, estimate)).toEqual(real);
  });

  it("still max-merges partial REAL reports (Anthropic split usage)", () => {
    const start = { prompt_tokens: 100, completion_tokens: 0, cache_read_input_tokens: 30 };
    const delta = { prompt_tokens: 0, completion_tokens: 50 };
    expect(mergeUsage(start, delta)).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 30,
    });
  });
});

describe("passthrough stream — finish_reason before the usage trailer", () => {
  it("persists the real usage, not max(estimate, real)", async () => {
    let persisted = null;
    const upstream =
      oa(chatChunk({ role: "assistant", content: "Hello there" })) +
      oa(chatChunk({}, "stop")) +
      oa({ id: "chatcmpl-abcdef123456", choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }) +
      "data: [DONE]\n\n";

    const out = await feed(
      upstream,
      createPassthroughStreamWithLogger("openai", null, "gpt-x", "c1", body, (_content, usage) => { persisted = usage; })
    );

    expect(out).toContain('"prompt_tokens":100');
    expect(persisted).toMatchObject({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
    expect(persisted.estimated).toBeUndefined();
  });
});
