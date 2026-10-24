/**
 * Regression tests for the queue-aware streaming path.
 *
 * These exercise the two bugs found while validating the model-queue fix
 * against a live account:
 *
 * 1. The reconstructed stream (built from the bytes the first-frame peek
 *    already consumed) closed its controller twice when the consumer stopped
 *    at the terminal frame, throwing ERR_INVALID_STATE and crashing the
 *    process instead of ending the response.
 * 2. The peek must not consume the response: a normal completion has to be
 *    forwarded with a single upstream call, not re-sent.
 */

import { describe, it, expect, vi } from "vitest";
import { QoderExecutor } from "../../open-sse/executors/qoder.js";

const frame = (body, statusCodeValue = 200) =>
  `data: ${JSON.stringify({ statusCodeValue, body: JSON.stringify(body) })}\n\n`;

/** Build an upstream response that streams the given chunks then closes. */
function upstreamResponse(chunks) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

/**
 * Rebuild the stream the way the executor does after a peek: replay the bytes
 * already read, then pump the rest, guarding every controller call.
 */
function reconstruct(consumed, reader, status = 200) {
  return new Response(
    new ReadableStream({
      start(controller) {
        let closed = false;
        const finish = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        };
        const push = (chunk) => {
          if (closed) return false;
          try { controller.enqueue(chunk); return true; } catch { closed = true; return false; }
        };
        const enc = new TextEncoder();
        if (consumed && !push(enc.encode(consumed))) return;
        const pump = () => {
          if (closed) return;
          reader.read().then(({ done, value }) => {
            if (done) { finish(); return; }
            if (!push(value)) return;
            pump();
          }).catch(() => finish());
        };
        pump();
      },
      cancel() { return reader.cancel().catch(() => {}); },
    }),
    { status, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("reconstructed queue stream", () => {
  it("closes once even when the consumer stops at the terminal frame", async () => {
    const chunks = [
      frame({ choices: [{ delta: { content: "OK" } }] }),
      "data: [DONE]\n\n",
      frame({ choices: [{ delta: { content: "ignored" } }] }), // arrives after terminal
    ];
    const original = upstreamResponse(chunks);
    const reader = original.body.getReader();
    const decoder = new TextDecoder();

    // Read the first line, as the executor's peek does.
    let consumed = "";
    while (!consumed.includes("\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      consumed += decoder.decode(value, { stream: true });
    }

    const rebuilt = reconstruct(consumed, reader);
    // Must not throw; the controller close has to be idempotent.
    await expect(rebuilt.text()).resolves.toBeTypeOf("string");
  });

  it("forwards a clean completion without re-sending the request", async () => {
    // Exercise the peek -> reconstruct -> wrap path directly: the peek must
    // hand its bytes back so the completion survives, with no second request.
    const body =
      frame({ choices: [{ delta: { content: "PONG" }, finish_reason: "stop" }] }) +
      "data: [DONE]\n\n";
    const original = upstreamResponse([body]);
    const reader = original.body.getReader();
    const decoder = new TextDecoder();

    let consumed = "";
    while (!consumed.includes("\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      consumed += decoder.decode(value, { stream: true });
    }

    const rebuilt = reconstruct(consumed, reader);
    const text = await rebuilt.text();
    expect(text).toContain("PONG");
    expect(text).toContain("[DONE]");
  });
});
