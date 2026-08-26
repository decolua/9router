import { describe, expect, it } from "vitest";

import { createMetricAccumulator } from "../../src/app/(dashboard)/dashboard/playground/lib/metrics.js";

describe("Playground metrics", () => {
  it("uses first non-empty assistant delta for TTFT and normalized usage only", () => {
    // Given: deterministic dispatch and terminal client timestamps
    const metrics = createMetricAccumulator(100);

    // When: an empty delta precedes real text, then authoritative usage and completion
    metrics.record({ type: "delta", text: "" }, 120);
    metrics.record({ type: "delta", text: "Hello" }, 140);
    metrics.record({
      type: "usage",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    }, 150);
    metrics.record({ type: "done" }, 180);

    // Then: duration ends at terminal, TTFT begins at meaningful assistant text, and usage is unestimated
    expect(metrics.snapshot()).toEqual({
      durationMs: 80,
      ttftMs: 40,
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      terminalState: "complete",
    });
  });

  it("does not fabricate usage or infer terminal success from reader close", () => {
    // Given: a stream that emits content but no authoritative usage or terminal evidence
    const metrics = createMetricAccumulator(100);
    metrics.record({ type: "delta", text: "partial" }, 130);

    // When: transport closes without a [DONE] frame
    metrics.record({ type: "incomplete" }, 190);

    // Then: usage stays absent for the UI to render as Unavailable
    expect(metrics.snapshot()).toEqual({
      durationMs: 90,
      ttftMs: 30,
      usage: null,
      terminalState: "incomplete",
    });
  });

  it("captures aborted and error terminal states without replacing the first terminal", () => {
    // Given: independent aborted and failed streams
    const aborted = createMetricAccumulator(10);
    const failed = createMetricAccumulator(10);

    // When: each stream reaches its terminal event
    aborted.abort(50);
    failed.record({ type: "error", message: "connection reset" }, 60);
    failed.record({ type: "done" }, 70);

    // Then: terminal states remain exact and stable
    expect(aborted.snapshot()).toMatchObject({ durationMs: 40, terminalState: "aborted", usage: null });
    expect(failed.snapshot()).toMatchObject({ durationMs: 50, terminalState: "error", usage: null });
  });
});
