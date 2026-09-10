import { describe, it, expect, beforeEach, vi } from "vitest";

import { handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

const encoder = new TextEncoder();
const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

// Build a provider Response whose body emits the given raw SSE chunks then closes
// cleanly. Status is 200 throughout: the whole point of #3463 is that the HTTP
// layer reports success while the payload carries nothing usable.
function sseResponse(chunks, { contentType = "text/event-stream" } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": contentType } });
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Run a two-model fallback combo, recording which models were actually attempted.
// `consume: false` leaves the body unread so a test can assert on bodyUsed.
async function runCombo(responders, { models = ["p1/first", "p2/second"], consume = true } = {}) {
  const attempted = [];
  const response = await handleComboChat({
    body: { model: "combo", stream: true, messages: [{ role: "user", content: "hi" }] },
    models,
    handleSingleModel: async (_body, modelStr) => {
      attempted.push(modelStr);
      return responders[modelStr]();
    },
    log: silentLog,
    comboName: "combo",
    comboStrategy: "fallback",
  });
  return { attempted, response, text: consume ? await response.text() : null };
}

describe("combo failover on empty-but-successful streams (#3463)", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("falls over when the first model returns HTTP 200 with zero meaningful frames", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse([": keepalive\n\n"]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"real answer"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toContain("real answer");
  });

  it("falls over when the stream closes without sending a single byte", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse([]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"second model"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toContain("second model");
  });

  it("treats a stream carrying only [DONE] as a failure", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse(["data: [DONE]\n\n"]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"after done"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toContain("after done");
  });

  it("reports 503 when every combo model returns an empty stream", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => sseResponse([": ping\n\n"]),
      "p2/second": () => sseResponse([]),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(response.status).toBe(503);
  });

  it("returns the first model untouched when it does send content", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse(['data: {"choices":[{"delta":{"content":"first wins"}}]}\n\n']),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"must not run"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toContain("first wins");
    expect(text).not.toContain("must not run");
  });

  it("preserves a frame split across two network chunks", async () => {
    const { attempted, text } = await runCombo({
      // A naive peek that decodes per-chunk would corrupt or drop this frame.
      "p1/first": () => sseResponse(['data: {"choi', 'ces":[{"delta":{"content":"split frame"}}]}\n\n']),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toContain("split frame");
    expect(text).not.toContain("fallback");
  });

  it("replays every byte, including frames that precede the first meaningful one", async () => {
    const { text } = await runCombo({
      "p1/first": () => sseResponse([
        ": warmup\n\n",
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"body text"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      "p2/second": () => sseResponse([]),
    });

    expect(text).toContain(": warmup");
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain("body text");
    expect(text).toContain("[DONE]");
  });

  // Regression guard for the review finding: a stream made only of envelope
  // frames is the #3463 bug, so none of these may count as content.
  it.each([
    ["role + finish_reason only", [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]],
    ["empty-string content delta", [
      'data: {"choices":[{"delta":{"content":""}}]}\n\n',
      "data: [DONE]\n\n",
    ]],
    ["empty tool_calls array", [
      'data: {"choices":[{"delta":{"tool_calls":[]}}]}\n\n',
      "data: [DONE]\n\n",
    ]],
    ["claude message_start envelope only", [
      'data: {"type":"message_start","message":{"id":"m1","content":[]}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]],
    ["claude content_block_start text envelope only", [
      'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n\n',
    ]],
    ["usage frame reporting zero output tokens", [
      'data: {"usage":{"prompt_tokens":12,"completion_tokens":0}}\n\n',
      "data: [DONE]\n\n",
    ]],
    ["gemini candidate with no parts", [
      'data: {"candidates":[{"content":{"parts":[]}}]}\n\n',
    ]],
    ["gemini candidate with empty text part", [
      'data: {"candidates":[{"content":{"parts":[{"text":""}]}}]}\n\n',
    ]],
  ])("fails over on a metadata-only stream: %s", async (_name, frames) => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse(frames),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"rescued"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first", "p2/second"]);
    expect(text).toContain("rescued");
  });

  // Shapes that genuinely carry output must never trigger failover.
  it.each([
    ["reasoning-only delta", 'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n'],
    ["claude text_delta", 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n'],
    ["claude tool_use block start", 'data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"ls"}}\n\n'],
    ["claude input_json_delta", 'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}\n\n'],
    ["responses output_text delta", 'data: {"type":"response.output_text.delta","delta":"token"}\n\n'],
    ["gemini text part", 'data: {"candidates":[{"content":{"parts":[{"text":"gem"}]}}]}\n\n'],
    ["gemini functionCall part", 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"f"}}]}}]}\n\n'],
    ["ollama message content", 'data: {"message":{"content":"olla"}}\n\n'],
    ["usage with output tokens", 'data: {"usage":{"prompt_tokens":5,"completion_tokens":9}}\n\n'],
  ])("accepts a stream whose only frame is %s", async (_name, frame) => {
    const { attempted } = await runCombo({
      "p1/first": () => sseResponse([frame]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"must not run"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
  });

  it("replays upstream bytes verbatim when the preamble is not valid UTF-8", async () => {
    // Decoding to a string and re-encoding would rewrite these bytes to U+FFFD.
    // The client must receive exactly what upstream sent.
    const invalidPreamble = new Uint8Array([0x3a, 0x20, 0xff, 0xfe, 0x0a, 0x0a]);
    const contentFrame = encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    const raw = new Uint8Array([...invalidPreamble, ...contentFrame]);

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(invalidPreamble);
        controller.enqueue(contentFrame);
        controller.close();
      },
    });

    const response = await handleComboChat({
      body: { model: "combo", stream: true, messages: [{ role: "user", content: "hi" }] },
      models: ["p1/first", "p2/second"],
      handleSingleModel: async () => new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      log: silentLog,
      comboName: "combo",
      comboStrategy: "fallback",
    });

    const received = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(received)).toEqual(Array.from(raw));
  });

  it("passes the stream through once the peek byte budget is exhausted", async () => {
    // A provider that streams non-content frames forever must not be buffered
    // without bound; past the budget the guard stops holding bytes.
    const filler = `: ${"x".repeat(8 * 1024)}\n\n`;
    const chunks = Array.from({ length: 48 }, () => filler);

    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse(chunks),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"must not run"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    // Everything buffered before the cap is still replayed: no silent byte loss.
    expect(text.length).toBe(filler.length * chunks.length);
    expect(text).not.toContain("must not run");
  });

  it("accepts a tool-call-only stream as meaningful", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"ls"}}]}}]}\n\n',
      ]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toContain("tool_calls");
  });

  it("accepts a Claude-format content block as meaningful", async () => {
    const { attempted, text } = await runCombo({
      "p1/first": () => sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"claude text"}}\n\n',
      ]),
      "p2/second": () => sseResponse(['data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n']),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toContain("claude text");
  });

  it("leaves non-SSE responses alone so tts/search/image combos are unaffected", async () => {
    // Guard must not read audio/image/JSON bodies. An empty JSON object is a
    // legitimate 200 for those callers and must pass straight through.
    const { attempted, text } = await runCombo({
      "p1/first": () => jsonResponse({}),
      "p2/second": () => jsonResponse({ should: "not run" }),
    });

    expect(attempted).toEqual(["p1/first"]);
    expect(text).toBe("{}");
  });

  it("does not consume a non-stream JSON completion body", async () => {
    const { attempted, response } = await runCombo({
      "p1/first": () => jsonResponse({ choices: [{ message: { content: "json answer" } }] }),
      "p2/second": () => jsonResponse({ should: "not run" }),
    }, { consume: false });

    expect(attempted).toEqual(["p1/first"]);
    // bodyUsed must still be false: the guard skipped it entirely.
    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      choices: [{ message: { content: "json answer" } }],
    });
  });
});

describe("combo empty-stream guard is time-bounded (#3463)", () => {
  it("gives up on a keepalive-only stream instead of blocking forever", async () => {
    // A stream that never closes and never sends content: without a deadline the
    // guard would await the first content frame indefinitely.
    vi.resetModules();
    process.env.STREAM_FIRST_CHUNK_TIMEOUT_MS = "150";
    try {
      const { handleComboChat: freshCombo } = await import("../../open-sse/services/combo.js");

      let keepAliveTimer = null;
      const neverEnding = new Response(
        new ReadableStream({
          start(controller) {
            keepAliveTimer = setInterval(() => {
              try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
            }, 10);
          },
          cancel() { clearInterval(keepAliveTimer); },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );

      const attempted = [];
      const started = Date.now();
      const response = await freshCombo({
        body: { model: "combo", stream: true, messages: [{ role: "user", content: "hi" }] },
        models: ["p1/hang", "p2/second"],
        handleSingleModel: async (_body, modelStr) => {
          attempted.push(modelStr);
          if (modelStr === "p1/hang") return neverEnding;
          return sseResponse(['data: {"choices":[{"delta":{"content":"rescued"}}]}\n\n']);
        },
        log: silentLog,
        comboName: "combo",
        comboStrategy: "fallback",
      });
      const elapsed = Date.now() - started;
      clearInterval(keepAliveTimer);

      expect(attempted).toEqual(["p1/hang", "p2/second"]);
      expect(await response.text()).toContain("rescued");
      // Proves the deadline fired rather than the stream ending on its own.
      expect(elapsed).toBeLessThan(3000);
    } finally {
      delete process.env.STREAM_FIRST_CHUNK_TIMEOUT_MS;
      vi.resetModules();
    }
  });
});
