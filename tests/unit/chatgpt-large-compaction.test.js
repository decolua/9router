import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactionTranscript, openCompactionSummary } from "../../src/lib/chatgpt/compact.js";
import { compactionBudget, splitCompactionTranscript } from "../../src/lib/chatgpt/compactionRunner.js";

const db = vi.hoisted(() => ({ getSettings: vi.fn(), validateApiKey: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
const { routeChatGPTResponse } = await import("../../src/lib/chatgpt/endpoint.js");
const key = "large-qa-key", model = "9router/Deepseek";
const request = (input, signal, stream = true) => new Request("http://router/api/chatgpt/v1/responses", {
  method: "POST", signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ model, stream, input: [...input, { type: "compaction_trigger" }] }),
});
const completion = (text, status = "completed") => Response.json({ status, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 500, output_tokens: 20, total_tokens: 520 } });
const events = text => text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));

beforeEach(() => {
  vi.clearAllMocks();
  db.validateApiKey.mockResolvedValue(true);
  db.getSettings.mockResolvedValue({ chatgptIntegration: { models: [{ id: "Deepseek", contextWindow: 1_000_000 }] } });
});

describe("large Codex history compaction", () => {
  it("summarizes every part of a multi-megabyte tool result and combines facts in order", async () => {
    const input = [{ role: "user", content: "Keep FACT_START. No deployment approval." }, {
      type: "function_call_output", call_id: "test_call",
      output: "日志🚀 escaped\\n test output ".repeat(45000) + " FACT_MIDDLE " + "build step succeeded ".repeat(100000),
    }, { role: "user", content: "FACT_END. Next: review app.js." }];
    const originalParts = [];
    let active = 0, peak = 0, merged = false;
    const handler = vi.fn(async req => {
      expect(Object.fromEntries(req.headers)).toEqual({ authorization: `Bearer ${key}`, "content-type": "application/json" });
      const body = await req.json();
      expect(body.model).toBe("Deepseek");
      const text = body.input[0].content[0].text;
      // Simulates a provider that rejects the original oversized prompt.
      if (Buffer.byteLength(text) > 262144) return Response.json({ error: { message: "The prompt is too long" } }, { status: 400 });
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (text.startsWith('{"chronological_summaries":')) merged = true;
      else originalParts.push(text);
      const facts = text.match(/FACT_(?:START|MIDDLE|END)/g) || [];
      return completion([...new Set(facts)].join(" ") || "Build output: successful checks.");
    });
    const response = await routeChatGPTResponse(request(input), handler);
    const output = events(await response.text());
    const items = output.filter(event => event.type === "response.output_item.done");
    expect(items).toHaveLength(1);
    expect(openCompactionSummary(items[0].item.encrypted_content, key)).toBe("FACT_START FACT_MIDDLE FACT_END");
    expect(originalParts.join("")).toBe(compactionTranscript({ input }));
    expect(merged).toBe(true);
    expect(peak).toBe(2);
    expect(output[0].type).toBe("ping");
    expect(output.at(-1).type).toBe("response.completed");
    expect(handler.mock.calls.length).toBeGreaterThan(3);
  });

  it("splits UTF-8 without losing or replacing characters and respects small model windows", () => {
    const text = "Ж🙂\\n\"中".repeat(3000);
    const { partBytes, maxOutputTokens } = compactionBudget(4096);
    const parts = splitCompactionTranscript(text, partBytes);
    expect(parts.join("")).toBe(text);
    expect(parts.every(part => Buffer.byteLength(part) + maxOutputTokens + 2048 <= 4096)).toBe(true);
    expect(compactionBudget(1_000_000).maxOutputTokens).toBe(8192);
  });

  it.each(["incomplete", "empty"])("recovers a %s successful HTTP response by splitting only the affected part", async failure => {
    const input = [{ role: "user", content: "FACT_FIRST " + "build-check-01 passed\n".repeat(15000) },
      { role: "user", content: "FACT_LAST " + "build-check-02 passed\n".repeat(15000) }];
    const received = [];
    const handler = vi.fn(async req => {
      const payload = await req.json();
      expect(payload.max_output_tokens).toBe(8192);
      const text = payload.input[0].content[0].text;
      received.push(text);
      if (!text.startsWith('{"chronological_summaries":') && Buffer.byteLength(text) > 130000) {
        if (failure === "empty") return Response.json({ status: "completed", output: [], usage: { output_tokens: 0 } });
        return Response.json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "truncated" }] }], usage: { output_tokens: 8192 } });
      }
      const facts = [...new Set(text.match(/FACT_(?:FIRST|LAST)/g) || [])];
      return completion(facts.join(" ") || "build checks passed");
    });
    const response = await routeChatGPTResponse(request(input), handler);
    const output = events(await response.text());
    expect(output.at(-1).type).toBe("response.completed");
    const item = output.find(event => event.type === "response.output_item.done")?.item;
    expect(openCompactionSummary(item.encrypted_content, key)).toContain("FACT_FIRST");
    expect(openCompactionSummary(item.encrypted_content, key)).toContain("FACT_LAST");
    expect(received.some(text => Buffer.byteLength(text) > 130000)).toBe(true);
    expect(received.some(text => Buffer.byteLength(text) < 130000)).toBe(true);
  });

  it("keeps readable reasoning and attachment context without serializing opaque state", () => {
    const text = compactionTranscript({ input: [
      { type: "reasoning", encrypted_content: "opaque".repeat(100000), summary: [{ text: "Check permissions first" }] },
      { role: "user", content: [{ type: "input_text", text: "Screenshot shows the build failed" }, { type: "input_image", image_url: "data:image/png;base64," + "a".repeat(1000000) }] },
    ] });
    expect(text).toContain("Check permissions first");
    expect(text).toContain("Screenshot shows the build failed");
    expect(Buffer.byteLength(text)).toBeLessThan(1000);
    expect(text).not.toContain("base64");
  });

  it.each(["upstream", "incomplete", "empty"])("does not replace any history when a part fails: %s", async failure => {
    let calls = 0;
    const handler = vi.fn(async () => {
      calls++;
      if (failure === "upstream" && calls === 2) return Response.json({ error: { message: "Background check pending" } }, { status: 503 });
      if (failure === "incomplete") return completion("unfinished", "incomplete");
      if (failure === "empty") return completion("");
      return completion("Part one summary");
    });
    const response = await routeChatGPTResponse(request([{ role: "user", content: "history ".repeat(100000) }]), handler);
    const output = events(await response.text());
    expect(output.some(event => event.type === "response.output_item.done" || event.type === "response.completed")).toBe(false);
    expect(output.at(-1)).toMatchObject({ type: "response.failed", response: { status: "failed", output: [], error: { message: expect.any(String) } } });
    expect(output.at(-1).response.error.message.toLowerCase()).toContain("history was not replaced");
    expect(calls).toBeLessThan(failure === "upstream" ? 4 : 15);
  });

  it("delivers headers before inference completes and cancels every active part on disconnect", async () => {
    const active = [];
    const handler = vi.fn(req => new Promise((_, reject) => {
      active.push(req.signal);
      req.signal.addEventListener("abort", () => reject(req.signal.reason), { once: true });
    }));
    const response = await routeChatGPTResponse(request([{ role: "user", content: "history ".repeat(100000) }]), handler);
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"ping"');
    expect(active).toHaveLength(2);
    await reader.cancel();
    expect(active.every(signal => signal.aborted)).toBe(true);
  });

  it("also uses bounded compaction for the non-streaming envelope", async () => {
    const response = await routeChatGPTResponse(request([{ role: "user", content: "history ".repeat(100000) }], undefined, false), async () => completion("Complete summary"));
    expect(response.status).toBe(200);
    expect((await response.json()).output[0].type).toBe("compaction");
  });

  it("ends with an error at the deadline even if an upstream ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const response = await routeChatGPTResponse(request([{ role: "user", content: "history ".repeat(100000) }]), () => new Promise(() => {}));
      const finished = response.text();
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
      const output = events(await finished);
      expect(output.filter(event => event.type === "ping").length).toBeGreaterThan(1);
      expect(output.at(-1)).toMatchObject({ type: "response.failed", response: { error: { message: expect.stringContaining("time limit") } } });
      expect(output.some(event => event.type === "response.output_item.done")).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("rejects non-reducing summaries without dropping input or looping indefinitely", async () => {
    const response = await routeChatGPTResponse(request([{ role: "user", content: "x".repeat(600000) }]), async () => completion("s".repeat(250000)));
    const output = events(await response.text());
    expect(output.at(-1)).toMatchObject({ type: "response.failed", response: { error: { message: expect.stringContaining("did not reduce") } } });
    expect(output.some(event => event.type === "response.output_item.done")).toBe(false);
  });
});
