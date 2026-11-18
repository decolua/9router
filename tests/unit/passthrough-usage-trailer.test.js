// Passthrough (OpenAI-format upstream) usage trailer.
//
// OpenRouter sends the finish chunk without usage and the real usage in a later
// chunk. The stream layer estimated usage on the first finish chunk (body chars / 4)
// and then max-merged the real usage into the estimate, so clients saw the larger,
// estimated prompt_tokens (+40% in a logged DeepSeek request: 8778 real -> 12281).
// When the client asked for a usage trailer, the estimate must wait for the real
// usage and be used only if none arrives.
import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const BUFFER = 2000;
const BODY = {
  model: "deepseek/deepseek-v4.1-flash",
  stream: true,
  stream_options: { include_usage: true },
  messages: [{ role: "user", content: "x".repeat(40000) }],
};
const REAL = { prompt_tokens: 8778, completion_tokens: 16, total_tokens: 8794, prompt_tokens_details: { cached_tokens: 8704 } };

const base = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "deepseek/deepseek-v4.1-flash" };
const content = { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] };
const finish = { ...base, choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }] };
const finishWithUsage = { ...finish, usage: REAL };
const usageOnly = { ...base, choices: [], usage: REAL };

async function run(chunks, { body = BODY, done = true } = {}) {
  const encoder = new TextEncoder();
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
  const stream = new ReadableStream({ start(c) { c.enqueue(encoder.encode(text)); c.close(); } });
  const out = stream.pipeThrough(createPassthroughStreamWithLogger("openrouter", null, body.model, null, body));
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let s = "";
  for (;;) {
    const { value, done: d } = await reader.read();
    if (d) break;
    s += typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }
  s += decoder.decode();
  const lines = s.split("\n").filter((l) => l.startsWith("data: "));
  const events = lines.filter((l) => l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)));
  return { events, usages: events.filter((e) => e.usage).map((e) => e.usage), doneCount: lines.filter((l) => l === "data: [DONE]").length, lines };
}

describe("passthrough usage trailer with include_usage", () => {
  it("uses the real usage when it arrives after a usage-less finish chunk (OpenRouter shape)", async () => {
    const { usages } = await run([content, finish, finishWithUsage]);
    expect(usages).toHaveLength(1);
    expect(usages[0].prompt_tokens).toBe(REAL.prompt_tokens + BUFFER);
    expect(usages[0].prompt_tokens_details.cached_tokens).toBe(8704);
    expect(usages[0].estimated).toBeUndefined();
  });

  it("uses the real usage from a standard choices:[] usage chunk", async () => {
    const { usages } = await run([content, finish, usageOnly]);
    expect(usages).toHaveLength(1);
    expect(usages[0].prompt_tokens).toBe(REAL.prompt_tokens + BUFFER);
    expect(usages[0].estimated).toBeUndefined();
  });

  it("emits one estimated usage chunk before [DONE] when no usage ever arrives", async () => {
    const { events, usages, doneCount, lines } = await run([content, finish]);
    expect(usages).toHaveLength(1);
    expect(usages[0].estimated).toBe(true);
    expect(events.at(-1).choices).toEqual([]);
    expect(lines.at(-1)).toBe("data: [DONE]");
    expect(doneCount).toBe(1);
  });

  it("emits the estimate at end of stream when upstream closes without [DONE]", async () => {
    const { usages, doneCount, lines } = await run([content, finish], { done: false });
    expect(usages).toHaveLength(1);
    expect(usages[0].estimated).toBe(true);
    expect(lines.at(-1)).toBe("data: [DONE]");
    expect(doneCount).toBe(1);
  });

  it("adds no estimate when the stream is cut before any finish chunk", async () => {
    const { usages } = await run([content], { done: false });
    expect(usages).toHaveLength(0);
  });
});

describe("passthrough without include_usage keeps the previous behaviour", () => {
  it("injects the estimate into the usage-less finish chunk", async () => {
    const body = { ...BODY, stream_options: undefined };
    const { events } = await run([content, finish], { body });
    const fin = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(fin.usage?.estimated).toBe(true);
  });
});
