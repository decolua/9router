import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { PROVIDERS } = await import("../../open-sse/config/providers.js");

class CodexTimeoutExecutor extends BaseExecutor {
  constructor() {
    super("codex", PROVIDERS.codex);
  }

  transformRequest(_model, body) {
    return body;
  }
}

describe("Codex response-header timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("waits for the Codex TTFT budget and does not replay a large request", async () => {
    vi.useFakeTimers();
    mocks.proxyAwareFetch.mockImplementation((_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));

    const executor = new CodexTimeoutExecutor();
    const request = executor.execute({
      model: "gpt-5.5-xhigh",
      body: { input: new Array(240).fill({ role: "user", content: "large prompt" }) },
      stream: true,
      credentials: { accessToken: "token" },
      log: { debug: vi.fn() },
    });
    const rejection = expect(request).rejects.toThrow("aborted");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
});
