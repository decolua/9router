import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the persistence boundary is mocked; the streaming pipeline runs for real
// (ReadableStream -> Response -> handleStreamingResponse -> SSE transform).
const { saveRequestDetailMock } = vi.hoisted(() => ({
  saveRequestDetailMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: saveRequestDetailMock,
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

// Narrow injection seam: only the transform's terminal flush call
// (translateResponse(targetFormat, sourceFormat, null, state)) is made to throw,
// and only while a test explicitly arms the failure. The real translator runs for
// every chunk AND for every unarmed flush, so the streaming pipeline still runs
// for real; the existing flush-failure test arms the flag to exercise the flush()
// catch branch in open-sse/utils/stream.js without touching production code.
const { triggerFlushFailure } = vi.hoisted(() => ({
  triggerFlushFailure: { armed: false },
}));
vi.mock("../../open-sse/translator/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    translateResponse: (targetFormat, sourceFormat, chunk, state) => {
      if (chunk === null && triggerFlushFailure.armed) throw new Error("boom: transform flush failure");
      return actual.translateResponse(targetFormat, sourceFormat, chunk, state);
    },
  };
});

const { buildOnStreamComplete, handleStreamingResponse } = await import(
  "../../open-sse/handlers/chatCore/streamingHandler.js"
);
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");

const encoder = new TextEncoder();

function openAISSE(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function interruptedSSE(chunks, error) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.error(error);
    },
  });
}

// Emits every chunk through a normal pull() (so the terminal `data: [DONE]`
// sentinel is genuinely consumed as ordinary SSE), then fails the *next* pull
// with an upstream read error. This reproduces a valid stream that has already
// delivered its SSE terminal sentinel before the socket dies mid-read.
function doneThenReadErrorSSE(chunks, error) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }
      throw error;
    },
  });
}

async function drain(response) {
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

const baseBody = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true };

function makeStreamingResponse(bodyStream, streamController) {
  const requestStartTime = Date.now();
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
    provider: "openai",
    model: "gpt-4o",
    connectionId: "conn-1",
    apiKey: "sk-test",
    requestStartTime,
    body: baseBody,
    stream: true,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: baseBody },
  });

  return handleStreamingResponse({
    providerResponse: new Response(bodyStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    provider: "openai",
    model: "gpt-4o",
    sourceFormat: "openai",
    targetFormat: "openai",
    body: baseBody,
    stream: true,
    requestStartTime,
    connectionId: "conn-1",
    apiKey: "sk-test",
    streamController,
    onStreamComplete,
    streamDetailId,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: baseBody },
  });
}

// Same real pipeline as makeStreamingResponse, but with genuinely distinct
// source/target formats so buildTransformStream selects the TRANSLATE stream
// instead of the passthrough stream. The provider emits OpenAI wire SSE and the
// client speaks Claude, mirroring the real openai-upstream → claude-client route:
// targetFormat is the provider wire format, sourceFormat is the client format.
function makeTranslatedStreamingResponse(bodyStream, streamController, overrides = {}) {
  const sourceFormat = overrides.sourceFormat ?? "claude";
  const targetFormat = overrides.targetFormat ?? "openai";
  const endpoint = overrides.endpoint ?? "/v1/messages";
  const requestStartTime = Date.now();
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
    provider: "openai",
    model: "gpt-4o",
    connectionId: "conn-1",
    apiKey: "sk-test",
    requestStartTime,
    body: baseBody,
    stream: true,
    clientRawRequest: { endpoint, body: baseBody },
  });

  return handleStreamingResponse({
    providerResponse: new Response(bodyStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    provider: "openai",
    model: "gpt-4o",
    sourceFormat,
    targetFormat,
    body: baseBody,
    stream: true,
    requestStartTime,
    connectionId: "conn-1",
    apiKey: "sk-test",
    streamController,
    onStreamComplete,
    streamDetailId,
    clientRawRequest: { endpoint, body: baseBody },
  });
}

function detailContents() {
  return saveRequestDetailMock.mock.calls.map(([detail]) => detail?.response?.content);
}

// Record every byte the client has actually observed, snapshotting the
// observation buffer at the exact instant the persistence boundary is invoked.
// This proves ordering (terminal client bytes before success persistence) rather
// than merely that both eventually happened. Returns a promise + live getter so
// callers can start a genuinely concurrent reader before/while the pipeline runs.
function observeClientBytes() {
  let observed = "";
  let observedAtPersist = null;
  saveRequestDetailMock.mockImplementation(async () => {
    observedAtPersist = observed;
  });
  return {
    get observed() { return observed; },
    get observedAtPersist() { return observedAtPersist; },
    async consume(response) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) observed += decoder.decode(value, { stream: true });
      }
      observed += decoder.decode();
    },
  };
}

describe("streaming RequestDetails are terminal-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerFlushFailure.armed = false;
  });

  it("saves exactly one detail on normal completion, finalized through onStreamComplete", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const bodyStream = openAISSE([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    const result = await makeStreamingResponse(bodyStream, streamController);
    expect(result.success).toBe(true);
    await drain(result.response);

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail, opts] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("Hello");
    expect(opts.id).toBeTruthy();
  });

  it("never persists the eager 'Streaming in progress' placeholder", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const bodyStream = openAISSE([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "done" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    const result = await makeStreamingResponse(bodyStream, streamController);
    await drain(result.response);

    const contents = detailContents();
    expect(contents).not.toContain("[Streaming in progress...]");
    expect(
      saveRequestDetailMock.mock.calls.some(([d]) => d?.providerResponse === "[Streaming - raw response not captured]"),
    ).toBe(false);
  });

  it("writes exactly one terminal error detail when the stream is interrupted, without a later success write", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const bodyStream = interruptedSSE(
      [`data: ${JSON.stringify({ choices: [{ delta: { content: "par" } }] })}\n\n`],
      new Error("boom: upstream transform failure"),
    );

    const result = await makeStreamingResponse(bodyStream, streamController);
    await drain(result.response).catch(() => {});

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).not.toBe("success");
    expect(detailContents()).not.toContain("Hello");
  });

  it("persists exactly one terminal error detail before returning JSON for a non-SSE upstream response", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const requestStartTime = Date.now();
    const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-1",
      apiKey: "sk-test",
      requestStartTime,
      body: baseBody,
      stream: true,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: baseBody },
    });

    const result = await handleStreamingResponse({
      providerResponse: new Response("<html><title>502 Bad Gateway</title></html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
      provider: "openai",
      model: "gpt-4o",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: baseBody,
      stream: true,
      requestStartTime,
      connectionId: "conn-1",
      apiKey: "sk-test",
      streamController,
      onStreamComplete,
      streamDetailId,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: baseBody },
    });

    expect(result.success).toBe(false);
    expect(result.response.headers.get("content-type")).toContain("application/json");

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("error");
    expect(detailContents()).not.toContain("[Empty streaming response]");
  });

  it("persists exactly one terminal error detail when the transform flush throws", async () => {
    triggerFlushFailure.armed = true;
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const bodyStream = openAISSE([`data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`]);

    const result = await makeStreamingResponse(bodyStream, streamController);
    await drain(result.response).catch(() => {});

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("error");
    expect(detail.response.content).not.toBe("[Empty streaming response]");
  });

  it("keeps the single success detail when a read error follows a valid [DONE] sentinel", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const bodyStream = doneThenReadErrorSSE(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ],
      new Error("boom: upstream read failure after DONE"),
    );

    const result = await makeStreamingResponse(bodyStream, streamController);
    await drain(result.response).catch(() => {});

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("Hello");
    expect(detail.response.error).toBeUndefined();
  });

  it("keeps the single success detail when a read error follows a valid [DONE] on a translated stream", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });
    const bodyStream = doneThenReadErrorSSE(
      [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hel" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ],
      new Error("boom: upstream read failure after DONE (translated)"),
    );

    const result = await makeTranslatedStreamingResponse(bodyStream, streamController);
    expect(result.success).toBe(true);
    await drain(result.response).catch(() => {});

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("Hello");
    expect(detail.response.error).toBeUndefined();
  });

  it("emits the Claude message_stop terminal event to the client before persisting the single success detail when upstream content is followed directly by [DONE]", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });

    // Upstream OpenAI wire SSE: a content delta is immediately followed by the
    // [DONE] sentinel, WITHOUT any prior terminal chunk carrying finish_reason.
    // The translator therefore never emitted message_delta/message_stop inline,
    // so the terminal Claude bytes must still be produced (and observed by the
    // client) before the success RequestDetail is persisted.
    const bodyStream = openAISSE([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    // Consume the client response for real, recording every byte the client has
    // actually observed. We snapshot this observation buffer at the exact moment
    // the persistence boundary is invoked, so the assertion proves *ordering*
    // (terminal client bytes before success persistence) rather than merely that
    // both eventually happened.
    let observedClientBytes = "";
    let bytesObservedAtPersist = null;

    saveRequestDetailMock.mockImplementation(async () => {
      bytesObservedAtPersist = observedClientBytes;
    });

    const result = await makeTranslatedStreamingResponse(bodyStream, streamController);
    expect(result.success).toBe(true);

    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) observedClientBytes += decoder.decode(value, { stream: true });
    }
    observedClientBytes += decoder.decode();

    // Exactly one success detail, and the client-format terminal event must have
    // already been observed by the client at the instant it was persisted.
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");

    expect(bytesObservedAtPersist).not.toBeNull();
    expect(bytesObservedAtPersist).toContain("event: message_stop");
    // The full client stream must still carry exactly one terminal message_stop.
    expect(observedClientBytes.match(/event: message_stop/g) ?? []).toHaveLength(1);
  });

  it("emits the passthrough OpenAI [DONE] terminal bytes to a concurrently-reading client before persisting the single success detail", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });

    // Ordinary same-format passthrough (openai wire SSE -> openai client): a
    // content delta followed directly by the [DONE] sentinel. In passthrough mode
    // the terminal `data: [DONE]` line is forwarded inline, so those exact bytes
    // are the client-observable terminal event that must precede persistence.
    const bodyStream = openAISSE([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    // Consume the client response for real and *concurrently*: the reader is
    // actively pulling while the upstream is still transforming, recording every
    // byte the client has actually observed. We snapshot that observation buffer
    // at the exact instant the persistence boundary is invoked, so the assertion
    // proves ordering (terminal client bytes before success persistence) rather
    // than merely that both eventually happened.
    let observedClientBytes = "";
    let bytesObservedAtPersist = null;

    saveRequestDetailMock.mockImplementation(async () => {
      bytesObservedAtPersist = observedClientBytes;
    });

    const result = await makeStreamingResponse(bodyStream, streamController);
    expect(result.success).toBe(true);

    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    const consume = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) observedClientBytes += decoder.decode(value, { stream: true });
      }
      observedClientBytes += decoder.decode();
    })();

    await consume;

    // Exactly one success detail, and the passthrough terminal [DONE] bytes must
    // already have been observed by the client at the instant it was persisted.
    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("Hello");

    expect(bytesObservedAtPersist).not.toBeNull();
    expect(bytesObservedAtPersist).toContain("data: [DONE]");
    // The full client stream must still carry exactly one terminal [DONE].
    expect(observedClientBytes.match(/data: \[DONE\]/g) ?? []).toHaveLength(1);
  });

  it("observes the flush-synthesized finish_reason terminal bytes on a Responses-wire translated stream before persisting the single success detail", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });

    // Provider wire is Responses API SSE (codex-style); the client speaks OpenAI
    // chat-completions. Upstream cleanly EOFs WITHOUT a terminal
    // response.completed event, so the only client-observable terminal event —
    // the synthesized final chunk carrying finish_reason — is produced by the
    // translator's flush (translateResponse(..., null, state)), not by an
    // inline chunk. Those flush terminal bytes must reach the client before the
    // success RequestDetail is persisted.
    const bodyStream = openAISSE([
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}\n\n`,
    ]);

    const observation = observeClientBytes();

    const result = await makeTranslatedStreamingResponse(bodyStream, streamController, {
      sourceFormat: "openai",
      targetFormat: "openai-responses",
      endpoint: "/v1/chat/completions",
    });
    expect(result.success).toBe(true);

    await observation.consume(result.response);

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");

    expect(observation.observedAtPersist).not.toBeNull();
    expect(observation.observedAtPersist).toContain('"finish_reason":"stop"');
    expect(observation.observed.match(/"finish_reason":"stop"/g) ?? []).toHaveLength(1);
  });

  it("emits a Claude message_stop terminal event before persisting the single success detail when upstream OpenAI EOFs cleanly without finish_reason or [DONE]", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });

    // Upstream OpenAI wire SSE: a content delta then a clean EOF. There is NO
    // finish_reason chunk and NO [DONE] sentinel, so the translator never
    // emitted message_delta/message_stop inline. A clean EOF of a valid
    // translated stream must still deliver the client-format terminal event
    // (message_stop) before the success RequestDetail is persisted — otherwise
    // the recorded outcome races ahead of a terminal the client never received.
    const bodyStream = openAISSE([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
    ]);

    const observation = observeClientBytes();

    const result = await makeTranslatedStreamingResponse(bodyStream, streamController);
    expect(result.success).toBe(true);

    await observation.consume(result.response);

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("Hello");

    expect(observation.observed).toContain("event: message_stop");
    expect(observation.observedAtPersist).not.toBeNull();
    expect(observation.observedAtPersist).toContain("event: message_stop");
    expect(observation.observed.match(/event: message_stop/g) ?? []).toHaveLength(1);
  });

  it("keeps the established success terminal when the client cancels its reader after receiving the terminal bytes, instead of overwriting it with client_disconnect", async () => {
    const streamController = createStreamController({ provider: "openai", model: "gpt-4o" });

    // A complete passthrough stream whose terminal [DONE] bytes are delivered to
    // the client, which then closes its socket (reader.cancel). The disconnect
    // is observed while the pipeline is still in its terminal-delivery wait, so
    // the already-delivered successful terminal result must remain the recorded
    // outcome — the late client_disconnect may not replace it.
    const bodyStream = openAISSE([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    const result = await makeStreamingResponse(bodyStream, streamController);
    expect(result.success).toBe(true);

    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let observed = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        observed += decoder.decode(value, { stream: true });
        if (observed.includes("data: [DONE]")) {
          await reader.cancel();
          break;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(saveRequestDetailMock).toHaveBeenCalledTimes(1);
    const [detail] = saveRequestDetailMock.mock.calls[0];
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("Hello");
    expect(detail.response.error).toBeUndefined();
  });
});
