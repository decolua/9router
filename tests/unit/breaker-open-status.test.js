import { describe, it, expect } from "vitest";
import { clientStatusForBreakerOpen, clientStatusForUpstream, unavailableResponse } from "open-sse/utils/error.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

/**
 * Reported from production: with the circuit breaker open on codex, the router
 * answered
 *
 *   404  [codex/gpt-5.6-luna] [404]: HTTP 404 (reset after 1m 58s)
 *
 * The model was in /v1/models the whole time and served the request two minutes
 * later. A client classifying on status read 404 as "never retry", spent three
 * retries in six seconds, and gave up on a breaker that needed two minutes.
 */
describe("breaker-open status classification", () => {
  it("reports a bodyless 404 cooldown as 503, not the upstream 404", () => {
    expect(clientStatusForBreakerOpen(404, "[404]: HTTP 404")).toBe(503);
  });

  /**
   * The correction is deliberately ONE status wide.
   *
   * The tempting version — "we locked the account, so the state is transient,
   * so return 503" — is false. checkFallbackError cools an account down for 30s
   * on any error it has no rule for, client-fault 400s included. Remapping the
   * whole path would resurrect the incident error-classification.md forbids.
   */
  describe("does not touch any other class", () => {
    it.each([
      ["a rejected parameter", 400, "Invalid 'temperature': expected <= 2, got 5"],
      ["an over-long prompt", 400, "prompt is too long: 250000 > 200000"],
      ["a malformed tool schema", 422, "tools[0].function.parameters must be an object"],
      ["a conflict", 409, "conflict"],
      ["a revoked key", 401, "invalid_api_key"],
      ["payment required", 402, "payment required"],
      ["forbidden", 403, "forbidden"],
    ])("keeps %s as its own 4xx", (_label, status, text) => {
      expect(clientStatusForBreakerOpen(status, text)).toBe(status);
      // and identical to what the shared classifier would have said
      expect(clientStatusForBreakerOpen(status, text)).toBe(clientStatusForUpstream(status, text));
    });

    it.each([
      ["429", 429],
      ["500", 500],
      ["502", 502],
      ["503", 503],
    ])("leaves %s alone (already retryable)", (_label, status) => {
      expect(clientStatusForBreakerOpen(status, "boom")).toBe(clientStatusForUpstream(status, "boom"));
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a non-numeric code", "NaN"],
    ])("falls back to 503 for %s, same as before", (_label, status) => {
      expect(clientStatusForBreakerOpen(status, "Unavailable")).toBe(503);
    });
  });

  /**
   * This is the regression guard for the mistake above. It asserts the PREMISE,
   * not just the output: an account really does get locked by a client-fault
   * 400, so anything that assumes "locked implies transient" is wrong.
   */
  it("a client-fault 400 locks the account yet must still return 400", () => {
    const verdict = checkFallbackError(400, "prompt is too long: 250000 > 200000");
    expect(verdict.shouldFallback).toBe(true);
    expect(verdict.permanent).toBeFalsy();

    expect(clientStatusForBreakerOpen(400, "prompt is too long: 250000 > 200000")).toBe(400);
  });

  it("keeps 404 when the text really does name a missing model", () => {
    for (const text of [
      "[404]: model gpt-9 not found",
      "Model foo is not supported",
      "model bar does not exist",
      '{"type":"ModelError"}',
    ]) {
      expect(clientStatusForBreakerOpen(404, text)).toBe(404);
    }
  });

  // The reporter asked for "503 with a Retry-After: 118 header". The header was
  // already emitted; only the status was wrong. Pin both together so a future
  // change cannot drop the header while fixing something else.
  it("emits Retry-After in seconds alongside the 503", async () => {
    const resetAt = new Date(Date.now() + 118_000).toISOString();
    const status = clientStatusForBreakerOpen(404, "[404]: HTTP 404");
    const res = unavailableResponse(status, "[codex/gpt-5.6-luna] [404]: HTTP 404", resetAt, "reset after 1m 58s");

    expect(res.status).toBe(503);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(110);
    expect(retryAfter).toBeLessThanOrEqual(118);

    const body = await res.json();
    expect(body.error.message).toContain("reset after 1m 58s");
    // The upstream detail survives: it is the operator's only clue about WHY the
    // breaker opened. It just no longer decides the class.
    expect(body.error.message).toContain("HTTP 404");
  });

  it("never emits a Retry-After below 1 second, even on an already-passed reset", () => {
    const res = unavailableResponse(503, "msg", new Date(Date.now() - 60_000).toISOString(), "reset after 0s");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});
