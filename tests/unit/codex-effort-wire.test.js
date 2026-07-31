import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Outbound wire proof for Codex reasoning.effort.
 * Official openai/codex: semantic Ultra serializes as Max for requests
 * (ReasoningEffortConfig::Ultra => Max; ultra_reasoning_uses_max_for_requests).
 * One POST, no adaptive retry, wire value never "ultra".
 */

const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";

function normalSseResponse() {
  const text = [
    "event: response.output_text.delta",
    'data: {"type":"response.output_text.delta","delta":"ok"}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed"}',
    "",
  ].join("\n");
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const proxyAwareFetch = vi.fn(async () => normalSseResponse());

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Codex effort wire encoding (official Ultra→Max)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockClear();
    proxyAwareFetch.mockImplementation(async () => normalSseResponse());
  });

  async function executeWithEffort(model, effortFields) {
    const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
    const executor = new CodexExecutor();
    return executor.execute({
      model,
      body: {
        model,
        input: "hi",
        ...effortFields,
      },
      stream: true,
      credentials: {
        accessToken: "test-token",
        connectionId: "conn_test",
        providerSpecificData: { chatgptAccountId: "acct_test" },
      },
      log: null,
    });
  }

  function parsePostedBody() {
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(CODEX_URL);
    expect(options.method).toBe("POST");
    return JSON.parse(options.body);
  }

  it("posts exactly once with reasoning.effort=max for Sol ultra intent", async () => {
    await executeWithEffort("gpt-5.6-sol", { reasoning: { effort: "ultra" } });

    const body = parsePostedBody();
    expect(body.reasoning.effort).toBe("max");
    expect(body.reasoning.effort).not.toBe("ultra");
    expect(body.reasoning.effort).not.toBe("xhigh");
    expect(body.model).toBe("gpt-5.6-sol");
  });

  it("posts exactly once with reasoning.effort=max for explicit Sol max", async () => {
    await executeWithEffort("gpt-5.6-sol", { reasoning: { effort: "max" } });

    const body = parsePostedBody();
    expect(body.reasoning.effort).toBe("max");
    expect(body.model).toBe("gpt-5.6-sol");
  });

  it("posts max for Terra ultra via legacy reasoning_effort", async () => {
    await executeWithEffort("gpt-5.6-terra", { reasoning_effort: "ultra" });

    const body = parsePostedBody();
    expect(body.reasoning.effort).toBe("max");
    expect(body.model).toBe("gpt-5.6-terra");
  });

  it("posts max for Sol-ultra model suffix (suffix stripped)", async () => {
    await executeWithEffort("gpt-5.6-sol-ultra", {});

    const body = parsePostedBody();
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe("max");
  });

  it("does not promote an uppercase unknown effort through the wire alias", async () => {
    await executeWithEffort("gpt-5.5", { reasoning: { effort: "ULTRA" } });

    const body = parsePostedBody();
    expect(body.reasoning.effort).toBe("ULTRA");
    expect(body.reasoning.effort).not.toBe("max");
  });
});
