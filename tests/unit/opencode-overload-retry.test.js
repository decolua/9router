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
    async execute() {
      return baseExecuteMock();
    }
  },
}));

vi.mock("../../open-sse/services/opencodeTlsClient.js", () => ({
  opencodeTlsFetch: vi.fn(),
}));

const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");

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

async function run(executor, log) {
  const pending = executor.execute({
    model: "deepseek-v4.1-flash-free",
    body: { messages: [{ role: "user", content: "say OK" }] },
    stream: true,
    credentials: {},
    log,
  });
  // Let every backoff timer fire (4 attempts max, well under a minute).
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
});
