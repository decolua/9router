import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/shared/zedAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveZedModels: vi.fn(),
    zedLlmFetch: vi.fn(),
    fetchZedAuthenticatedUser: vi.fn(),
    summarizeZedPlan: vi.fn(() => null),
  };
});

import ZedExecutor from "../../open-sse/executors/zed.js";
import {
  resolveZedModels,
  zedLlmFetch,
} from "../../open-sse/shared/zedAuth.js";

describe("ZedExecutor completions envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveZedModels.mockResolvedValue({
      rawById: new Map([
        ["claude-sonnet-4-6", { provider: "anthropic" }],
      ]),
    });
    zedLlmFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "An internal server error occurred." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("posts snake_case provider + NDJSON accept to /completions", async () => {
    const executor = new ZedExecutor();
    await executor.execute({
      model: "claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: {
        accessToken: "tok",
        providerSpecificData: { userId: "u1" },
      },
    });

    expect(zedLlmFetch).toHaveBeenCalledTimes(1);
    const [, path, options] = zedLlmFetch.mock.calls[0];
    expect(path).toBe("/completions");
    expect(options.fetchOptions.headers.Accept).toMatch(/ndjson/);
    const payload = JSON.parse(options.fetchOptions.body);
    expect(payload.provider).toBe("anthropic");
    expect(payload.model).toBe("claude-sonnet-4-6");
    expect(payload.provider_request).toBeTruthy();
    expect(payload.thread_id).toBeTruthy();
    expect(payload.prompt_id).toBeTruthy();
  });

  it("forwards connection proxy options into zedLlmFetch", async () => {
    const executor = new ZedExecutor();
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:8888" };
    await executor.execute({
      model: "claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "tok", providerSpecificData: { userId: "u1" } },
      proxyOptions,
    });
    expect(zedLlmFetch.mock.calls[0][2].proxyOptions).toEqual(proxyOptions);
    expect(resolveZedModels.mock.calls[0][1].proxyOptions).toEqual(proxyOptions);
  });
});
