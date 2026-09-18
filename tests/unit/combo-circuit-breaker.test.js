import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";
import {
  CIRCUIT_STATE,
  COMBO_CIRCUIT_DEFAULTS,
  beginComboModelAttempt,
  classifyComboFailure,
  clearComboCircuitBreakerState,
  getComboCircuitState,
  inspectSuccessfulComboResponse,
  recordComboModelFailure,
  recordComboModelSuccess,
  runManualComboModelProbe,
} from "../../open-sse/services/comboCircuitBreaker.js";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe("combo model circuit breaker", () => {
  beforeEach(() => {
    clearComboCircuitBreakerState();
    vi.clearAllMocks();
  });

  it("opens after consecutive failures, skips traffic, then allows one half-open recovery request", () => {
    const model = "provider/model-a";
    const now = Date.now();

    recordComboModelFailure(model, { reason: "upstream_unavailable", status: 503, now });
    recordComboModelFailure(model, { reason: "upstream_unavailable", status: 503, now: now + 1 });
    expect(getComboCircuitState(model).state).toBe(CIRCUIT_STATE.CLOSED);

    recordComboModelFailure(model, { reason: "upstream_unavailable", status: 503, now: now + 2 });
    const opened = getComboCircuitState(model);
    expect(opened.state).toBe(CIRCUIT_STATE.OPEN);
    expect(beginComboModelAttempt(model, now + 3).allowed).toBe(false);

    const probeAt = new Date(opened.nextProbeAt).getTime();
    const probe = beginComboModelAttempt(model, probeAt);
    expect(probe.allowed).toBe(true);
    expect(probe.halfOpen).toBe(true);
    expect(beginComboModelAttempt(model, probeAt + 1).allowed).toBe(false);

    recordComboModelSuccess(model, { latencyMs: 120, now: probeAt + 2 });
    expect(getComboCircuitState(model).state).toBe(CIRCUIT_STATE.CLOSED);
  });

  it("keeps circuit state isolated per provider/model", () => {
    recordComboModelFailure("provider/model-a", {
      reason: "unsupported_model",
      status: 404,
      immediate: true,
    });

    expect(getComboCircuitState("provider/model-a").state).toBe(CIRCUIT_STATE.OPEN);
    expect(getComboCircuitState("provider/model-b").state).toBe(CIRCUIT_STATE.CLOSED);
  });

  it("opens immediately for unsupported models", () => {
    recordComboModelFailure("provider/dead-model", {
      reason: "unsupported_model",
      status: 401,
      immediate: true,
    });

    const state = getComboCircuitState("provider/dead-model");
    expect(state.state).toBe(CIRCUIT_STATE.OPEN);
    expect(new Date(state.nextProbeAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("classifies rate limits as immediate circuit failures", () => {
    expect(classifyComboFailure(429, "rate limited")).toEqual({
      reason: "rate_limited",
      immediate: true,
    });
  });

  it("detects an empty successful response", async () => {
    const response = new Response("", {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Length": "0" },
    });

    const inspected = await inspectSuccessfulComboResponse(response);
    expect(inspected.ok).toBe(false);
    expect(inspected.reason).toBe("empty_response");
  });

  it("rejects an SSE stream that ends without a meaningful event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const inspected = await inspectSuccessfulComboResponse(response, { firstEventTimeoutMs: 100 });
    expect(inspected.ok).toBe(false);
    expect(inspected.reason).toBe("empty_stream");
  });

  it("preserves a valid streaming response after first-event validation", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const inspected = await inspectSuccessfulComboResponse(response, { firstEventTimeoutMs: 100 });
    expect(inspected.ok).toBe(true);
    expect(await inspected.response.text()).toContain("Hi");
  });

  it("marks a valid response as slow when latency exceeds the threshold", async () => {
    const response = new Response('{"choices":[{"message":{"content":"ok"}}]}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const inspected = await inspectSuccessfulComboResponse(response, {
      startedAt: Date.now() - COMBO_CIRCUIT_DEFAULTS.slowResponseThresholdMs - 1,
    });
    expect(inspected.ok).toBe(true);
    expect(inspected.slow).toBe(true);
  });

  it("releases an open model only after a successful real inference probe", async () => {
    const model = "provider/recovering-model";
    recordComboModelFailure(model, {
      reason: "upstream_unavailable",
      status: 503,
      immediate: true,
    });

    const execute = vi.fn(async (probeBody) => {
      expect(probeBody.model).toBe(model);
      expect(probeBody.stream).toBe(false);
      expect(probeBody.messages?.[0]?.content).toBe("Reply with OK.");
      return new Response('{"choices":[{"message":{"content":"OK"}}]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await runManualComboModelProbe(model, execute);
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getComboCircuitState(model).state).toBe(CIRCUIT_STATE.CLOSED);
  });

  it("keeps a model open when its recovery probe fails", async () => {
    const model = "provider/still-dead-model";
    recordComboModelFailure(model, {
      reason: "upstream_unavailable",
      status: 503,
      immediate: true,
    });

    const result = await runManualComboModelProbe(
      model,
      async () => new Response('{"error":{"message":"still unavailable"}}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(result.ok).toBe(false);
    expect(getComboCircuitState(model).state).toBe(CIRCUIT_STATE.OPEN);
  });

  it("skips an open model inside a combo and immediately tries the next one", async () => {
    const dead = "provider/dead-model";
    const healthy = "provider/healthy-model";
    recordComboModelFailure(dead, {
      reason: "unsupported_model",
      status: 401,
      immediate: true,
    });

    const handler = vi.fn(async (_body, model) => {
      if (model === dead) throw new Error("dead model should have been skipped");
      return new Response('{"choices":[{"message":{"content":"ok"}}]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hello" }] },
      models: [dead, healthy],
      handleSingleModel: handler,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(response.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.any(Object), healthy);
  });
});
