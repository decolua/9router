// F27 / RM7 — trackPendingRequest accounting: every +1 must have EXACTLY one −1.
//
// Findings docs/orchestration/findings/T1.1.md §M7 + F24b follow-up:
//  1. chatCore.js translate-failure path decremented (−1, error=true) BEFORE the
//     request's only +1 (chatCore :343) → the decrement stole a *live* request's
//     credit on the same (connectionId, model) and cancelled usageRepo's 60 s
//     PENDING_TIMEOUT_MS safeguard for requests that are still running.
//  2. Streaming completion decremented in stream.js flush AND potentially again
//     in chatCore onDisconnect/onError ("flush ran, reader still draining" race)
//     → double −1, clamped to 0 by Math.max → zeroes another live request.
// The chat.js per-account latch (99045eff) does not cover these sites.
//
// Fix contract: a settle-once guard keyed on the per-request token (reqLogger).
// begin = the +1; settle = the −1, idempotent, and a no-op if the request never
// began. stream.js flush settles through the same guard.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { trackMock, executeMock, refreshMock, onRefreshedSpy, failTranslate } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  executeMock: vi.fn(),
  refreshMock: vi.fn(),
  onRefreshedSpy: vi.fn(async () => {}),
  failTranslate: { on: false },
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: trackMock,
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: false,
    execute: executeMock,
    refreshCredentials: refreshMock,
    needsRefresh: () => false,
  }),
}));

// Fresh object per call = unique per-request token, like the real createRequestLogger.
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

// Keep the real translator (stream.js needs initState/translateResponse); allow tests
// to force translateRequest failure to hit the chatCore :200 path.
vi.mock("../../open-sse/translator/index.js", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    translateRequest: (...args) => (failTranslate.on ? null : orig.translateRequest(...args)),
  };
});

const { beginPendingGuard, settlePendingGuard, hasPendingGuard, createSSEStream } = await import(
  "../../open-sse/utils/stream.js"
);
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

function chatArgs(credentials, connectionId, extra = {}) {
  return {
    body: { model: "f27test/m1", stream: false, messages: [{ role: "user", content: "hi" }] },
    modelInfo: { provider: "f27test", model: "m1" },
    credentials,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId,
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: {} },
    ...extra,
  };
}

async function drain(stream) {
  const readable = stream.readable ?? stream;
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function feed(sseText, transform) {
  const input = new Blob([sseText]).stream();
  return drain(input.pipeThrough(transform));
}

beforeEach(() => {
  vi.clearAllMocks();
  failTranslate.on = false;
});

describe("A — settle-once guard (stream.js)", () => {
  it("begin emits exactly the +1; settle emits at most ONE −1 however many times called", () => {
    const token = { id: "req-1" }; // stands in for the per-request reqLogger
    beginPendingGuard(token, "m1", "p1", "c1");
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock.mock.calls[0].slice(0, 4)).toEqual(["m1", "p1", "c1", true]);

    // Simulate the race: flush settles, then onDisconnect, then onError.
    expect(settlePendingGuard(token)).toBe(true);
    settlePendingGuard(token, true);
    settlePendingGuard(token);
    expect(trackMock).toHaveBeenCalledTimes(2); // RED: 4 — every call decremented
    expect(trackMock.mock.calls[1].slice(0, 4)).toEqual(["m1", "p1", "c1", false]);
  });

  it("settle for a token that never began does NOT decrement (no stolen credit)", () => {
    const lonely = { id: "never-begun" };
    const other = { id: "other" };
    beginPendingGuard(other, "m1", "p1", "c1"); // a live request owns this tally
    trackMock.mockClear();

    expect(settlePendingGuard(lonely, true)).toBe(false);
    expect(trackMock).not.toHaveBeenCalled(); // RED: called (m1,p1,c1,false,true)
    expect(hasPendingGuard(lonely)).toBe(false);
  });

  it("flush() settles the guard instead of a raw −1, so flush+disconnect = one −1", async () => {
    const token = { id: "stream-1" };
    beginPendingGuard(token, "g", "p", "c");
    trackMock.mockClear();

    const out = await feed(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
      createSSEStream({ mode: "passthrough", provider: "p", model: "g", connectionId: "c", reqLogger: token })
    );
    expect(out).toContain("data: [DONE]");
    expect(trackMock).toHaveBeenCalledTimes(1); // flush settled the guard
    expect(trackMock.mock.calls[0].slice(0, 4)).toEqual(["g", "p", "c", false]);

    // Late client disconnect after the flush already settled: must not decrement again.
    settlePendingGuard(token);
    expect(trackMock).toHaveBeenCalledTimes(1); // RED: 2
  });

  it("streams with no guard registered keep the legacy raw decrement (standalone consumers)", async () => {
    const bareLogger = { id: "unguarded" };
    await feed(
      'data: {"choices":[{"delta":{"content":"x"}},{"finish_reason":"stop"}]}\n\n',
      createSSEStream({ mode: "passthrough", provider: "p", model: "m", connectionId: "c", reqLogger: bareLogger })
    );
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock.mock.calls[0].slice(0, 4)).toEqual(["m", "p", "c", false]);
  });
});

describe("B — chatCore translate-failure must not emit an unpaired −1", () => {
  it("translate failure returns 400 and touches trackPendingRequest ZERO times", async () => {
    failTranslate.on = true;
    const result = await handleChatCore(chatArgs({ accessToken: "AT" }, "conn-T"));

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    // RED: called once with (m1, f27test, conn-T, false, true) — a −1 before any +1.
    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe("C — RM5 wiring: 401 refresh path tells the callback WHICH model", () => {
  it("onCredentialsRefreshed receives { model } so lock resets can be model-scoped", async () => {
    const okJson = () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const un401 = () =>
      new Response(JSON.stringify({ error: { message: "invalid_token" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    executeMock.mockImplementation(async ({ credentials }) => ({
      response: credentials?.accessToken === "AT-fresh" ? okJson() : un401(),
      url: "https://idp.test/f27/v1/chat/completions",
      headers: {},
      transformedBody: null,
    }));
    refreshMock.mockResolvedValue({ accessToken: "AT-fresh", refreshToken: "RT2", expiresIn: 3600 });

    const creds = { accessToken: "AT-stale", refreshToken: "RT1", connectionId: "conn-M" };
    const result = await handleChatCore(chatArgs(creds, "conn-M", { onCredentialsRefreshed: onRefreshedSpy }));
    expect(result.success).toBe(true);
    expect(onRefreshedSpy).toHaveBeenCalledTimes(1);
    // RED: today chatCore calls onCredentialsRefreshed(newCredentials) with no
    // model context — the account-wide lock wipe cannot be scoped.
    expect(onRefreshedSpy.mock.calls[0][1]).toEqual({ model: "m1" });
  });
});
