/**
 * #3488 — a streaming request the client aborts left no trace.
 *
 * `onStreamComplete` is invoked from the SSE transform's flush, and the flush
 * only runs on a clean upstream EOF. When the client goes away the pipeline is
 * cancelled instead, so the usage row, the request detail and the "done" line
 * were all skipped — even though the provider had already generated (and
 * billed) the partial response. Recent Requests then looks frozen while traffic
 * is flowing.
 *
 * These tests drive `handleStreamingResponse` with a fake upstream and cancel
 * the client side mid-stream, which is what `DISCONNECT: ResponseAborted` is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = { details: [], usage: [] };

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async (detail) => { saved.details.push(detail); }),
  saveRequestUsage: vi.fn(async (row) => { saved.usage.push(row); }),
  trackPendingRequest: vi.fn(() => {}),
}));

const { handleStreamingResponse, buildOnStreamComplete } = await import(
  "../../open-sse/handlers/chatCore/streamingHandler.js"
);
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

const encoder = new TextEncoder();

/** Upstream that emits `chunks` and then stays open until `hold` resolves. */
function upstreamResponse(chunks, { close = false } = {}) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const body = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) { controller.close(); return; }
      await held;
      controller.close();
    },
  });
  return {
    response: { body, headers: new Headers({ "content-type": "text/event-stream" }), status: 200 },
    release: () => release(),
  };
}

const CHUNKS = [
  'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Counting "}}]}\n\n',
  'data: {"id":"1","choices":[{"index":0,"delta":{"content":"one two three"}}]}\n\n',
];

function baseCtx(overrides = {}) {
  return {
    provider: "opencode",
    model: "hy3-free",
    sourceFormat: "openai",
    targetFormat: "openai",
    body: { model: "hy3-free", stream: true, messages: [{ role: "user", content: "Count slowly from 1 to 100" }] },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "conn-1",
    apiKey: "sk-test",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    ...overrides,
  };
}

async function runUntilFirstChunkThenCancel(providerResponse, ctx) {
  const result = await handleStreamingResponse({ ...ctx, providerResponse });
  const reader = result.response.body.getReader();
  await reader.read();          // client receives the first bytes...
  await reader.cancel();        // ...then goes away
  await new Promise((resolve) => setTimeout(resolve, 20));
  return result;
}

describe("#3488 aborted streaming requests are recorded", () => {
  beforeEach(() => {
    saved.details.length = 0;
    saved.usage.length = 0;
  });

  it("records the partial stream when the client disconnects", async () => {
    const calls = [];
    const ctx = baseCtx();
    const { onStreamComplete, onStreamAborted, streamDetailId } = buildOnStreamComplete(ctx);
    const streamController = createStreamController({ provider: ctx.provider, model: ctx.model });
    const upstream = upstreamResponse(CHUNKS);

    await runUntilFirstChunkThenCancel(upstream.response, {
      ...ctx,
      streamController,
      onStreamComplete,
      onStreamAborted: (snapshot, reason) => { calls.push({ snapshot, reason }); onStreamAborted(snapshot, reason); },
      streamDetailId,
    });
    upstream.release();

    expect(calls).toHaveLength(1);
    expect(calls[0].snapshot.content).toContain("Counting");

    const aborted = saved.details.filter((d) => d.status === "aborted");
    expect(aborted).toHaveLength(1);
    expect(aborted[0].response.finish_reason).toMatch(/^aborted: /);
    // Usage is unknown on an abort, so it is estimated from the partial content
    // rather than dropped — the provider has already billed for it.
    expect(saved.usage).toHaveLength(1);
    expect(saved.usage[0].tokens.completion_tokens).toBeGreaterThan(0);
  });

  it("records under the same detail id, so the row is updated and not duplicated", async () => {
    const ctx = baseCtx();
    const { onStreamComplete, onStreamAborted, streamDetailId } = buildOnStreamComplete(ctx);
    const streamController = createStreamController({ provider: ctx.provider, model: ctx.model });
    const upstream = upstreamResponse(CHUNKS);

    await runUntilFirstChunkThenCancel(upstream.response, {
      ...ctx, streamController, onStreamComplete, onStreamAborted, streamDetailId,
    });
    upstream.release();

    // Two writes: the placeholder saved when the stream starts, then the abort
    // update — both under the id the stream was opened with, so the dashboard
    // row is replaced rather than duplicated.
    expect(saved.details).toHaveLength(2);
    expect(saved.details.map((d) => d.id)).toEqual([streamDetailId, streamDetailId]);
    expect(saved.details.map((d) => d.status)).toEqual(["success", "aborted"]);
  });

  it("does not record an abort for a stream that ends normally", async () => {
    const calls = [];
    const ctx = baseCtx();
    const { onStreamComplete, onStreamAborted, streamDetailId } = buildOnStreamComplete(ctx);
    const streamController = createStreamController({ provider: ctx.provider, model: ctx.model });
    const upstream = upstreamResponse([...CHUNKS, "data: [DONE]\n\n"], { close: true });

    const result = await handleStreamingResponse({
      ...ctx,
      providerResponse: upstream.response,
      streamController,
      onStreamComplete,
      onStreamAborted: (snapshot, reason) => { calls.push(reason); onStreamAborted(snapshot, reason); },
      streamDetailId,
    });

    const reader = result.response.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual([]);
    expect(saved.details.some((d) => d.status === "aborted")).toBe(false);
  });
});
