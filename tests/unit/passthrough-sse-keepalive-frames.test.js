// Regression: AMD's upstream (and other vLLM/SGLang-fronted lanes) tags every
// SSE chunk with an `id: N` line and closes the stream with a bare `id:` frame
// after the terminal usage chunk. Such payload-less frames are spec-legal
// keepalive no-ops, but the OpenAI Python SDK flushes an event on ANY buffered
// field and then json.loads("") the missing data — which aborts a streaming
// turn mid tool-call (Hermes Agent surfaced it as provider_stream_empty_frame;
// OMP survived because its parser skips non-JSON lines).
//
// The passthrough transform must hold id:/retry:/event: framing until the frame
// proves it carries a data line, and drop the whole frame otherwise.
import { describe, it, expect } from "vitest";

import { createSSEStream } from "../../open-sse/utils/stream.js";

async function runThroughPassthrough(sse, chunkSplitter = null) {
  const stream = createSSEStream({ mode: "passthrough", provider: "amd" });
  const writer = stream.writable.getWriter();
  const readPromise = readAll(stream.readable);
  if (chunkSplitter) {
    for (const piece of chunkSplitter) {
      await writer.write(new TextEncoder().encode(piece));
    }
  } else {
    await writer.write(new TextEncoder().encode(sse));
  }
  await writer.close();
  return readPromise;
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

// Mirrors openai._streaming.SSEDecoder + the event consumption loop:
// field lines are buffered per frame; a blank line flushes an event when ANY
// field was set; the flush calls json.loads(data), so a frame that set only
// id:/retry:/event: crashes with "Expecting value: line 1 column 1".
// Returns the parsed data payloads; throws on the empty-data crash class.
function decodeOpenAiSdkStyle(sse) {
  const payloads = [];
  let fields = null;
  for (const line of sse.split("\n")) {
    if (line === "") {
      if (fields) {
        const data = fields.data ?? "";
        if (data === "[DONE]") {
          payloads.push("[DONE]");
        } else if (data.trim() === "") {
          throw new Error("provider_stream_empty_frame: json.loads('') on flush");
        } else {
          payloads.push(JSON.parse(data));
        }
        fields = null;
      }
      continue;
    }
    if (line.startsWith(":")) continue; // comment: skipped entirely
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let val = idx === -1 ? "" : line.slice(idx + 1);
    if (val.startsWith(" ")) val = val.slice(1);
    if (field === "data") fields = { ...(fields || {}), data: fields?.data === undefined ? val : fields.data + "\n" + val };
    else if (field === "event" || field === "id" || field === "retry") fields = { ...(fields || {}), [field]: val };
  }
  return payloads;
}

const chunk = (delta, extra = {}) => ({
  id: "chatcmpl-x",
  object: "chat.completion.chunk",
  created: 1700000000,
  model: "amd/Qwen3.8-Flash-Next",
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});

// Exactly the AMD wire shape: data line FIRST, `id:` AFTER it, blank terminator,
// and a trailing payload-less `id: 26` frame between usage and the sentinel.
function amdStyleStream() {
  const data = [
    chunk({ role: "assistant", content: "Hello" }),
    chunk({ content: " world", tool_calls: [{ index: 0, id: "call_1", function: { name: "web_search", arguments: "{\"q\":" } }] }),
    chunk({}, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    { id: "chatcmpl-x", object: "chat.completion.chunk", created: 1700000000, model: "amd/Qwen3.8-Flash-Next", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
  let sse = "";
  data.forEach((c, i) => {
    sse += `data: ${JSON.stringify(c)}\nid: ${i}\n\n`;
  });
  sse += "id: 26\n\n";
  sse += "event: done\ndata: [DONE]\nid: 27\n\n";
  return sse;
}

describe("passthrough payload-less SSE frame suppression", () => {
  it("drops every id-only frame so the OpenAI SDK decode never sees empty data", async () => {
    const out = await runThroughPassthrough(amdStyleStream());

    expect(out).not.toMatch(/^id:/m);
    // No event may flush with empty data (the Hermes crash class).
    const payloads = decodeOpenAiSdkStyle(out);
    // 4 chunks + upstream [DONE] + flush()'s sentinel duplicate (pre-existing
    // passthrough behavior; the SDK stops consuming at the first [DONE]).
    expect(payloads).toHaveLength(6);
    expect(payloads[0].choices[0].delta.content).toBe("Hello");
    expect(payloads[4]).toBe("[DONE]");
  });

  it("proves the decoder model actually catches the raw AMD stream", () => {
    // Guard against a vacuous test: the UNFILTERED upstream shape must crash the
    // same decoder that passes on the router output above.
    expect(() => decodeOpenAiSdkStyle(amdStyleStream())).toThrow(/empty_frame/);
  });

  it("preserves the data payload and event framing of real frames", async () => {
    const out = await runThroughPassthrough(amdStyleStream());

    const dataLines = out.split("\n").filter((l) => l.startsWith("data: "));
    expect(JSON.parse(dataLines[1].slice(6)).choices[0].delta.tool_calls[0].function.name).toBe("web_search");
    // `event: done` must stay attached to its data line, not float into the
    // following flush()-injected sentinel.
    const lines = out.split("\n");
    const doneEventIdx = lines.findIndex((l) => l === "event: done");
    expect(lines[doneEventIdx + 1]).toBe("data: [DONE]");
  });

  it("drops event:-only and retry:-only keepalive frames entirely", async () => {
    const sse =
      "event: ping\n\n" +
      "retry: 5000\n\n" +
      `data: ${JSON.stringify(chunk({ content: "hi" }))}\n\n` +
      "data: [DONE]\n\n";
    const out = await runThroughPassthrough(sse);

    expect(out).not.toContain("event: ping");
    expect(out).not.toContain("retry:");
    expect(out).toContain("data: ");
    expect(() => decodeOpenAiSdkStyle(out)).not.toThrow();
  });

  it("keeps framing lines that precede a data line, in order", async () => {
    const sse =
      `id: 1\nevent: message\ndata: ${JSON.stringify(chunk({ content: "hi" }))}\n\n` +
      "data: [DONE]\n\n";
    const out = await runThroughPassthrough(sse);

    const lines = out.split("\n");
    const iData = lines.findIndex((l) => l.startsWith("data: {"));
    expect(lines[iData - 1]).toBe("event: message");
    expect(lines[iData - 2]).toBe("id: 1");
  });

  it("preserves comment keepalives and drops a held id without flushing it", async () => {
    // Google-style `: ping` keepalive inside a frame that already streamed data:
    // the comment must survive, the dangling id must not materialize a frame.
    const sse =
      `data: ${JSON.stringify(chunk({ content: "hi" }))}\n` +
      "id: 7\n" +
      ": keepalive\n\n" +
      "data: [DONE]\n\n";
    const out = await runThroughPassthrough(sse);

    expect(out).toContain(": keepalive");
    expect(out).not.toMatch(/^id:/m);
    expect(() => decodeOpenAiSdkStyle(out)).not.toThrow();
  });

  it("drops a dangling framing line when upstream closes without a terminator", async () => {
    const body = `data: ${JSON.stringify(chunk({ content: "hi" }))}\n\ndata: [DONE]\n\nid: 27`;
    const out = await runThroughPassthrough(body);

    expect(out).not.toMatch(/id:/);
    expect(() => decodeOpenAiSdkStyle(out)).not.toThrow();
  });

  it("survives id lines split across network chunk boundaries", async () => {
    const sse = amdStyleStream();
    const mid = sse.indexOf("id: 26");
    const out = await runThroughPassthrough(null, [sse.slice(0, mid + 3), sse.slice(mid + 3)]);

    expect(out).not.toMatch(/^id:/m);
    expect(() => decodeOpenAiSdkStyle(out)).not.toThrow();
  });
});
