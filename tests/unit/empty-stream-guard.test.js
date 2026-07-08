// Antigravity empty-stream guard: probe verdicts + byte-identical replay
// (#2188, #2229, #2259 — empty 200 streams / MALFORMED_FUNCTION_CALL aborts).
import { describe, it, expect } from "vitest";
import { probeSSEStream, replayStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sseBody(events, { chunkSize } = {}) {
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = encoder.encode(raw);
  return new ReadableStream({
    start(controller) {
      if (!chunkSize) {
        controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize));
        }
      }
      controller.close();
    },
  });
}

async function drain(stream) {
  const reader = stream.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const wrap = (response) => ({ response });

describe("probeSSEStream", () => {
  it("meaningful text releases the stream with a byte-identical replay", async () => {
    const events = [
      wrap({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }] } }] }),
      wrap({ candidates: [{ content: { parts: [{ text: "Hello there" }] } }] }),
      wrap({ candidates: [{ finishReason: "STOP" }] }),
    ];
    const probe = await probeSSEStream(sseBody(events), {});
    expect(probe.verdict).toBe("ok");
    const replayed = await drain(replayStream(probe.buffered, probe.reader));
    expect(replayed).toBe(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
  });

  it("functionCall-only stream is meaningful", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ candidates: [{ content: { parts: [{ functionCall: { name: "bash", args: {} } }] } }] }),
      wrap({ candidates: [{ finishReason: "STOP" }] }),
    ]), {});
    expect(probe.verdict).toBe("ok");
  });

  it("thought-only stream with STOP is empty", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ candidates: [{ content: { parts: [{ text: "let me think", thought: true }] } }] }),
      wrap({ candidates: [{ finishReason: "STOP" }] }),
    ]), {});
    expect(probe.verdict).toBe("empty");
  });

  it("whitespace-only text with STOP is empty", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ candidates: [{ content: { parts: [{ text: "  \n" }] }, finishReason: "STOP" }] }),
    ]), {});
    expect(probe.verdict).toBe("empty");
  });

  it("zero-data 200 stream is empty", async () => {
    const probe = await probeSSEStream(sseBody([]), {});
    expect(probe.verdict).toBe("empty");
    expect(probe.buffered.reduce((n, c) => n + c.length, 0)).toBe(0);
  });

  it("MALFORMED_FUNCTION_CALL before content is error_finish", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ candidates: [{ content: { parts: [{ text: "I'll call it now", thought: true }] } }] }),
      wrap({ candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }),
    ]), {});
    expect(probe.verdict).toBe("error_finish");
    expect(probe.reason).toBe("MALFORMED_FUNCTION_CALL");
  });

  it("MALFORMED after meaningful content still releases the stream", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ candidates: [{ content: { parts: [{ text: "Partial answer" }] } }] }),
      wrap({ candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }),
    ]), {});
    expect(probe.verdict).toBe("ok");
  });

  it("embedded error object before content is error_finish", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }),
    ]), {});
    expect(probe.verdict).toBe("error_finish");
    expect(probe.reason).toBe("RESOURCE_EXHAUSTED");
  });

  it("handles SSE events split across tiny read chunks", async () => {
    const events = [
      wrap({ candidates: [{ content: { parts: [{ text: "Split across reads" }] } }] }),
      wrap({ candidates: [{ finishReason: "STOP" }] }),
    ];
    const probe = await probeSSEStream(sseBody(events, { chunkSize: 7 }), {});
    expect(probe.verdict).toBe("ok");
    const replayed = await drain(replayStream(probe.buffered, probe.reader));
    expect(replayed).toBe(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
  });

  // Content blocks are deterministic — a retry resends the same blocked prompt and
  // exhaustion benches the account. The guard must release them so the translator
  // closes the stream as content_filter (#2188).
  it("promptFeedback.blockReason-only stream releases as ok, replayed byte-identically", async () => {
    const events = [wrap({ promptFeedback: { blockReason: "SAFETY" } })];
    const probe = await probeSSEStream(sseBody(events), {});
    expect(probe.verdict).toBe("ok");
    const replayed = await drain(replayStream(probe.buffered, probe.reader));
    expect(replayed).toBe(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
  });

  it("SAFETY finish before any meaningful content releases as ok, not empty", async () => {
    const probe = await probeSSEStream(sseBody([
      wrap({ candidates: [{ content: { parts: [{ text: "hmm", thought: true }] } }] }),
      wrap({ candidates: [{ finishReason: "SAFETY" }] }),
    ]), {});
    expect(probe.verdict).toBe("ok");
  });
});
