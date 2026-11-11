// The free lane sheds load with 429 "The inference service is overloaded.
// Please try again later." even after a request passes the TLS gate. The
// OpenCode CLI retries that transient 429; 9router used to surface it. These
// tests pin the executor-side retry so the CLI gets a response, while a real
// free-tier quota 429 is still delivered without delay.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Keep the retry loop under test in isolation: no network, no credentials.
const { baseExecuteMock } = vi.hoisted(() => ({ baseExecuteMock: vi.fn() }));

vi.mock("../../open-sse/executors/base.js", () => ({
  BaseExecutor: class {
    async execute(args) {
      return baseExecuteMock(args);
    }
  },
}));

vi.mock("../../open-sse/services/opencodeTlsClient.js", () => ({
  opencodeTlsFetch: vi.fn(),
}));

const { OpenCodeExecutor, forgetOpencodeSession } = await import("../../open-sse/executors/opencode.js");

const OVERLOAD = JSON.stringify({
  error: {
    type: "server_error",
    message: "The inference service is overloaded. Please try again later.",
  },
});

// The other 429 on this route: the free-tier gate, which is not transient. It
// also says "try again later", so the classifier must key on "overloaded".
const FREE_USAGE = JSON.stringify({
  type: "error",
  error: { type: "FreeUsageLimitError", message: "Free usage limit reached. Please try again later." },
});

function upstream(status, body) {
  return {
    response: new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    }),
  };
}

async function run(executor, log, credentials = {}) {
  const pending = executor.execute({
    model: "deepseek-v4.1-flash-free",
    body: { messages: [{ role: "user", content: "say OK" }] },
    stream: true,
    credentials,
    log,
  });
  // Let every backoff timer fire (8 attempts, ~20 s of backoff).
  await vi.advanceTimersByTimeAsync(60_000);
  return pending;
}

describe("OpenCodeExecutor overload retry", () => {
  beforeEach(() => {
    baseExecuteMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries the transient free-lane 429 and returns the recovered stream", async () => {
    baseExecuteMock
      .mockResolvedValueOnce(upstream(429, OVERLOAD))
      .mockResolvedValueOnce(upstream(429, OVERLOAD))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"));
    const log = { debug: vi.fn() };

    const result = await run(new OpenCodeExecutor("opencode", {}), log);

    expect(baseExecuteMock).toHaveBeenCalledTimes(3);
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe("data: ok\n\n");
    // The retry is observable to --debug users, like the base retry path.
    expect(log.debug).toHaveBeenCalledWith("RETRY", expect.stringContaining("overload"));
  });

  it("stops after eight attempts and hands the last 429 back intact", async () => {
    baseExecuteMock.mockImplementation(async () => upstream(429, OVERLOAD));

    const result = await run(new OpenCodeExecutor("opencode", {}));

    expect(baseExecuteMock).toHaveBeenCalledTimes(8);
    expect(result.response.status).toBe(429);
    // Reading the cloned body to classify the retry must not consume the
    // response the caller finally receives.
    expect(await result.response.text()).toBe(OVERLOAD);
  });

  it("does not retry a free-tier quota 429", async () => {
    baseExecuteMock.mockResolvedValue(upstream(429, FREE_USAGE));

    const result = await run(new OpenCodeExecutor("opencode", {}));

    expect(baseExecuteMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(429);
  });

  it("does not retry other upstream failures", async () => {
    baseExecuteMock.mockResolvedValue(upstream(500, '{"error":"boom"}'));

    const result = await run(new OpenCodeExecutor("opencode", {}));

    expect(baseExecuteMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(500);
  });

  it("stops at once when the caller has already aborted", async () => {
    baseExecuteMock.mockResolvedValue(upstream(429, OVERLOAD));
    const controller = new AbortController();
    controller.abort();

    const result = await new OpenCodeExecutor("opencode", {}).execute({
      model: "deepseek-v4.1-flash-free",
      body: { messages: [{ role: "user", content: "say OK" }] },
      stream: true,
      credentials: {},
      signal: controller.signal,
    });

    expect(baseExecuteMock).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(429);
  });

  it("aborts during backoff instead of sleeping out the schedule", async () => {
    baseExecuteMock.mockResolvedValue(upstream(429, OVERLOAD));
    const controller = new AbortController();

    const pending = new OpenCodeExecutor("opencode", {}).execute({
      model: "deepseek-v4.1-flash-free",
      body: { messages: [{ role: "user", content: "say OK" }] },
      stream: true,
      credentials: {},
      signal: controller.signal,
    });
    const settled = pending.then(() => "resolved", (e) => e.name);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(await settled).toBe("AbortError");
    expect(baseExecuteMock).toHaveBeenCalledTimes(1);
  });
});

// #5559: a minted session that upstream has spent or flagged used to be reused
// until restart. A non-transient rejection must drop it so the next request
// re-mints, while overload retries keep the same session.
describe("OpenCodeExecutor session invalidation", () => {
  const sessionOf = (call) => call[0].credentials._opencodeSession;
  // Unique identity per test so the module-level session cache does not leak.
  let creds;
  let n = 0;

  beforeEach(() => {
    baseExecuteMock.mockReset();
    vi.useFakeTimers();
    creds = { rawHeaders: { authorization: `Bearer test-${n++}` } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses one stable session across successful requests", async () => {
    baseExecuteMock.mockImplementation(async () => upstream(200, "data: ok\n\n"));
    const executor = new OpenCodeExecutor("opencode", {});

    await run(executor, undefined, creds);
    await run(executor, undefined, creds);

    const [a, b] = baseExecuteMock.mock.calls.map(sessionOf);
    expect(a).toMatch(/^ses_/);
    expect(b).toBe(a);
  });

  it.each([
    ["429 FreeUsageLimitError", 429, FREE_USAGE],
    ["403 FreeTierError", 403, '{"type":"error","error":{"type":"FreeTierError"}}'],
  ])("drops the session after %s so the next request re-mints", async (_label, status, body) => {
    baseExecuteMock
      .mockResolvedValueOnce(upstream(status, body))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"));
    const executor = new OpenCodeExecutor("opencode", {});

    const first = await run(executor, undefined, creds);
    expect(first.response.status).toBe(status);
    await run(executor, undefined, creds);

    const [a, b] = baseExecuteMock.mock.calls.map(sessionOf);
    expect(b).toMatch(/^ses_/);
    expect(b).not.toBe(a);
  });

  it("keeps the session through overload retries", async () => {
    baseExecuteMock
      .mockResolvedValueOnce(upstream(429, OVERLOAD))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"));
    const executor = new OpenCodeExecutor("opencode", {});

    await run(executor, undefined, creds);
    await run(executor, undefined, creds);

    const sessions = baseExecuteMock.mock.calls.map(sessionOf);
    expect(new Set(sessions).size).toBe(1);
  });

  it("drops a translated per-conversation session too", async () => {
    baseExecuteMock
      .mockResolvedValueOnce(upstream(429, FREE_USAGE))
      .mockResolvedValueOnce(upstream(200, "data: ok\n\n"));
    const executor = new OpenCodeExecutor("opencode", {});
    const convo = { ...creds, rawHeaders: { ...creds.rawHeaders, "x-session-id": `conv-${n}` } };

    const call = (c) => {
      const p = executor.execute({
        model: "deepseek-v4.1-flash-free",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: c,
        providerSessionId: `conv-${n}`,
      });
      return vi.advanceTimersByTimeAsync(60_000).then(() => p);
    };
    await call(convo);
    await call(convo);

    const [a, b] = baseExecuteMock.mock.calls.map(sessionOf);
    expect(b).not.toBe(a);
  });

  it("never touches a client-supplied native session", async () => {
    const native = "ses_0123456789abABCDEFGHIJKLMN";
    baseExecuteMock.mockResolvedValue(upstream(429, FREE_USAGE));
    const executor = new OpenCodeExecutor("opencode", {});
    const c = { rawHeaders: { "x-opencode-session": native } };

    await run(executor, undefined, c);
    await run(executor, undefined, c);

    expect(baseExecuteMock.mock.calls.map(sessionOf)).toEqual([native, native]);
  });

  it("forgetOpencodeSession ignores ids it never minted", () => {
    expect(forgetOpencodeSession("ses_unknown")).toBe(false);
    expect(forgetOpencodeSession(undefined)).toBe(false);
  });
});
