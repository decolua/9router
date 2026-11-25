import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  evaluateChatJson,
  evaluateEmbeddingJson,
  evaluateAudioResult,
  evaluateImageJson,
  evaluateVideoCreation,
  createStreamingOutcomeTracker,
  parseSSEBlocks,
  supportsOutcome,
} from "../../open-sse/utils/upstreamOutcome.js";

describe("shared upstream outcome evaluator", () => {
  it("rejects semantic error envelopes even when HTTP was 200", () => {
    expect(evaluateChatJson({ error: { message: "quota" } }, FORMATS.OPENAI).ok).toBe(false);
    expect(evaluateEmbeddingJson({ error: { message: "quota" } }).ok).toBe(false);
  });

  it("accepts reasoning-only and tool-only chat completions", () => {
    expect(evaluateChatJson({ choices: [{ message: { reasoning_content: "thinking" }, finish_reason: "length" }] }, FORMATS.OPENAI).ok).toBe(true);
    expect(evaluateChatJson({ choices: [{ message: { tool_calls: [{ id: "c1" }] }, finish_reason: "tool_calls" }] }, FORMATS.OPENAI).ok).toBe(true);
  });

  it("accepts float or base64 embeddings and rejects empty or malformed vectors", () => {
    expect(evaluateEmbeddingJson({ data: [{ embedding: [0.1, 0.2] }] }).ok).toBe(true);
    expect(evaluateEmbeddingJson({ data: [{ embedding: "AQID" }] }).ok).toBe(true);
    expect(evaluateEmbeddingJson({ data: [{ embedding: "%%%" }] }).ok).toBe(false);
    expect(evaluateEmbeddingJson({ data: [{ embedding: [] }] }).ok).toBe(false);
    expect(evaluateEmbeddingJson({ data: [] }, { allowEmpty: true }).ok).toBe(true);
  });

  it("requires non-empty valid base64 audio", () => {
    expect(evaluateAudioResult({ base64: "AQID" }).ok).toBe(true);
    expect(evaluateAudioResult({ base64: "%%%" }).errorKind).toBe("invalid_upstream_json");
    expect(evaluateAudioResult({ base64: "" }).errorKind).toBe("empty_upstream_response");
  });

  it("requires image evidence", () => {
    expect(evaluateImageJson({ data: [{ b64_json: "AQID" }] }).ok).toBe(true);
    expect(evaluateImageJson({ data: [{ url: "https://example.com/i.png" }] }).ok).toBe(true);
    expect(evaluateImageJson({ data: [{ b64_json: "%%%" }] })).toMatchObject({ ok: false, errorKind: "invalid_upstream_json" });
    expect(evaluateImageJson({ data: [] }).ok).toBe(false);
  });

  it("requires a video creation to return a job to poll", () => {
    expect(evaluateVideoCreation({ request_id: "req-1" }).ok).toBe(true);
    expect(evaluateVideoCreation({ id: "job-1", status: "pending" }).ok).toBe(true);
    expect(evaluateVideoCreation({ status: "pending" })).toMatchObject({ ok: false, errorKind: "invalid_upstream_json" });
    expect(evaluateVideoCreation({ status: "failed", error: { message: "bad prompt" } })).toMatchObject({ ok: false, message: "bad prompt" });
  });

  it("does not turn a finish chunk into success before EOF", () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    tracker.observe({ data: { choices: [{ delta: { content: "x" }, finish_reason: "stop" }] } });
    expect(tracker.snapshot().state).toBe("pending");
    expect(tracker.finish().ok).toBe(true);
  });

  it("classifies failure by whether downstream was committed", () => {
    const precommit = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    expect(precommit.fail("upstream_reset", "reset")).toMatchObject({
      state: "retryable_precommit_failure",
      fallbackAllowed: true,
    });

    const committed = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    committed.commit();
    expect(committed.fail("upstream_reset", "reset")).toMatchObject({
      state: "committed_failure",
      fallbackAllowed: false,
    });
  });

  it("routes a terminal-only Claude stream to fallback", () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.CLAUDE });
    tracker.observe({ event: "message_start", data: { type: "message_start", message: { usage: {} } } });
    tracker.observe({ event: "message_stop", data: { type: "message_stop" } });
    expect(tracker.finish()).toMatchObject({ ok: false, state: "retryable_precommit_failure", errorKind: "empty_upstream_response" });
  });

  it("accepts text, reasoning, tool and media evidence across wire dialects", () => {
    const text = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    text.observe({ data: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } });
    text.observe({ data: { type: "message_stop" } });
    expect(text.finish().ok).toBe(true);
    const tool = createStreamingOutcomeTracker({ format: FORMATS.CLAUDE });
    tool.observe({ data: { type: "content_block_start", content_block: { type: "tool_use", name: "read_file" } } });
    tool.observe({ data: { type: "message_stop" } });
    expect(tool.finish().ok).toBe(true);
    const media = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    media.observe({ data: { item: { type: "image_generation_call" } } });
    media.observe({ data: { choices: [{ delta: {}, finish_reason: "stop" }] } });
    expect(media.finish().ok).toBe(true);
  });

  it("rejects terminal-only non-stream responses", () => {
    expect(evaluateChatJson({ type: "message", stop_reason: "end_turn", content: [] }, FORMATS.CLAUDE).errorKind).toBe("empty_upstream_response");
    expect(evaluateChatJson({ choices: [{ message: {}, finish_reason: "stop" }] }, FORMATS.OPENAI).errorKind).toBe("empty_upstream_response");
    expect(evaluateChatJson({ object: "response", status: "in_progress", output: [] }, FORMATS.OPENAI_RESPONSES).errorKind).toBe("upstream_incomplete");
  });

  it("accepts a content filter or refusal as a legitimate empty answer", () => {
    expect(evaluateChatJson({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }, FORMATS.OPENAI).ok).toBe(true);
    expect(evaluateChatJson({ type: "message", stop_reason: "refusal", content: [] }, FORMATS.CLAUDE).ok).toBe(true);
    expect(evaluateChatJson({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }, FORMATS.GEMINI).ok).toBe(true);
    expect(evaluateChatJson({ object: "response", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] }, FORMATS.OPENAI_RESPONSES).ok).toBe(true);

    const stream = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    stream.observe({ data: { choices: [{ delta: { role: "assistant" }, finish_reason: "content_filter" }] } });
    expect(stream.finish().ok).toBe(true);
  });

  it("treats a Responses incomplete terminal as valid only when it carried output", () => {
    const truncated = createStreamingOutcomeTracker({ format: FORMATS.OPENAI_RESPONSES });
    truncated.observe({ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "partial" } });
    truncated.observe({ event: "response.incomplete", data: { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } } });
    expect(truncated.finish().ok).toBe(true);

    const empty = createStreamingOutcomeTracker({ format: FORMATS.OPENAI_RESPONSES });
    empty.observe({ event: "response.incomplete", data: { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } } });
    expect(empty.finish()).toMatchObject({ ok: false, errorKind: "empty_upstream_response" });
  });

  it("does not judge executor-specific stream dialects", () => {
    expect(supportsOutcome(FORMATS.OPENAI)).toBe(true);
    expect(supportsOutcome(FORMATS.KIRO)).toBe(false);
    expect(supportsOutcome(FORMATS.COMMANDCODE)).toBe(false);
    expect(evaluateChatJson({ some: "executor shape" }, FORMATS.KIRO).ok).toBe(true);
    expect(evaluateChatJson({ some: "executor shape" }, FORMATS.OPENAI).ok).toBe(false);
  });

  it("parses SSE blocks and NDJSON lines incrementally", () => {
    const events = [];
    const rest = parseSSEBlocks('event: a\ndata: {"x":1}\n\n{"done":false}\n{"done":true}\ndata: [DONE]\n\ndata: {"y"', (e) => events.push(e));
    expect(events).toEqual([
      { event: "a", data: { x: 1 }, doneSentinel: false },
      { event: null, data: { done: false }, doneSentinel: false },
      { event: null, data: { done: true }, doneSentinel: false },
      { event: null, data: null, doneSentinel: true },
    ]);
    expect(rest).toBe('data: {"y"');
  });

  it("treats a client cancel after a successful terminal as a finished request", () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI_RESPONSES });
    tracker.observe({ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "x" } });
    tracker.observe({ event: "response.completed", data: { type: "response.completed", response: { status: "completed" } } });
    expect(tracker.abortClient("client closed")).toMatchObject({ ok: true, state: "ok" });
  });

  it("keeps client abort distinct from upstream failure", () => {
    const tracker = createStreamingOutcomeTracker({ format: FORMATS.OPENAI });
    tracker.commit();
    expect(tracker.abortClient("cancelled")).toMatchObject({
      state: "client_aborted",
      errorKind: "aborted",
      clientDisconnected: true,
      fallbackAllowed: false,
    });
  });
});
