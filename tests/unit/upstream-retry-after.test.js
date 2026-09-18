// Upstream cooldown passthrough: when a provider says "retry in N seconds",
// 9router must forward that to the client as a Retry-After header. Without it
// an OpenAI-compatible caller (hermes, aider, etc.) sees a bare 429 and falls
// back to its own short generic backoff, hammering an already-overloaded
// provider — the GLM-via-proxy failure mode.
import { describe, it, expect } from "vitest";
import { parseUpstreamError, createErrorResult, errorResponse } from "open-sse/utils/error.js";

const upstream = (status, body, headers = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

describe("parseUpstreamError extracts the upstream cooldown", () => {
  it("reads Retry-After delta-seconds", async () => {
    const { statusCode, resetsAtMs } = await parseUpstreamError(
      upstream(429, { error: { message: "rate limited" } }, { "Retry-After": "30" })
    );
    expect(statusCode).toBe(429);
    expect(resetsAtMs - Date.now()).toBeGreaterThan(25_000);
    expect(resetsAtMs - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it("reads an HTTP-date Retry-After", async () => {
    const at = new Date(Date.now() + 45_000).toUTCString();
    const { resetsAtMs } = await parseUpstreamError(upstream(429, "slow down", { "Retry-After": at }));
    expect(resetsAtMs).toBeGreaterThan(Date.now() + 30_000);
  });

  it("falls back to a retry_after body field when a provider sends one", async () => {
    // Shape used by providers that put the cooldown in the body instead of the
    // header (e.g. Gemini retryDelay). NOT what Z.AI sends — see
    // tests/unit/glm-error-classification.test.js for the real GLM payloads,
    // which carry no cooldown at all.
    const { resetsAtMs } = await parseUpstreamError(
      upstream(429, { error: { message: "slow down", retry_after: 20 } })
    );
    expect(resetsAtMs - Date.now()).toBeGreaterThan(15_000);
  });

  it("ignores absent, zero, and past cooldowns", async () => {
    expect((await parseUpstreamError(upstream(429, { error: { message: "x" } }))).resetsAtMs).toBeUndefined();
    expect((await parseUpstreamError(upstream(429, "x", { "Retry-After": "0" }))).resetsAtMs).toBeUndefined();
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect((await parseUpstreamError(upstream(429, "x", { "Retry-After": past }))).resetsAtMs).toBeUndefined();
  });

  it("prefers an executor-parsed cooldown over the generic hint", async () => {
    const executor = {
      parseError: () => ({ status: 429, message: "quota", resetsAtMs: Date.now() + 300_000 }),
    };
    const { resetsAtMs } = await parseUpstreamError(
      upstream(429, "x", { "Retry-After": "5" }), executor
    );
    expect(resetsAtMs - Date.now()).toBeGreaterThan(200_000);
  });

  it("backfills the cooldown when the executor omits one", async () => {
    const executor = { parseError: () => ({ status: 429, message: "overloaded" }) };
    const { resetsAtMs } = await parseUpstreamError(
      upstream(429, "x", { "Retry-After": "25" }), executor
    );
    expect(resetsAtMs - Date.now()).toBeGreaterThan(20_000);
  });
});

describe("the client Response carries Retry-After", () => {
  it("emits the header from createErrorResult", () => {
    const result = createErrorResult(429, "overloaded", Date.now() + 30_000);
    expect(result.response.status).toBe(429);
    const header = Number(result.response.headers.get("Retry-After"));
    expect(header).toBeGreaterThan(25);
    expect(header).toBeLessThanOrEqual(31);
  });

  it("omits the header when there is no cooldown", () => {
    expect(createErrorResult(500, "boom").response.headers.get("Retry-After")).toBeNull();
    expect(errorResponse(400, "bad").headers.get("Retry-After")).toBeNull();
  });

  it("never emits a non-positive Retry-After", () => {
    // A cooldown that already expired must floor to 1s, never 0 or negative —
    // a "Retry-After: 0" invites an immediate hot-loop against the provider.
    const header = createErrorResult(429, "late", Date.now() - 10_000).response.headers.get("Retry-After");
    expect(Number(header)).toBeGreaterThanOrEqual(1);
  });

  it("keeps the OpenAI-compatible error body and CORS intact", async () => {
    const res = createErrorResult(429, "overloaded", Date.now() + 10_000).response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(body.error.message).toBe("overloaded");
    expect(body.error.type).toBeTruthy();
  });
});
