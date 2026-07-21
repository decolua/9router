import { describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

function transform(model, overrides = {}) {
  const executor = new CodexExecutor();
  const body = executor.transformRequest(model, {
    model,
    input: "Reply only OK",
    ...overrides,
  }, true, {});
  return { body, executor };
}

describe("Codex GPT-5.6 reasoning modes", () => {
  it.each([
    ["gpt-5.6-sol", "xhigh", undefined],
    ["gpt-5.6-sol", "max", undefined],
    ["gpt-5.6-sol-pro", "xhigh", "pro"],
    ["gpt-5.6-sol-pro", "max", "pro"],
  ])("maps %s at %s to an independent mode", (requestedModel, effort, expectedMode) => {
    const { body } = transform(requestedModel, { reasoning_effort: effort });
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning.effort).toBe(effort);
    expect(body.reasoning.summary).toBe("auto");
    expect(body.reasoning.mode).toBe(expectedMode);
  });

  it("lets an explicit valid mode override the virtual alias", () => {
    const { body } = transform("gpt-5.6-sol-pro", {
      reasoning: { effort: "xhigh", mode: "standard" },
    });
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning).toEqual({ effort: "xhigh", mode: "standard", summary: "auto" });
  });

  it("keeps alias metadata when chatCore has already resolved body.model", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.6-sol-pro", {
      model: "gpt-5.6-sol",
      input: "Reply only OK",
      reasoning_effort: "max",
    }, true, {});
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning).toEqual({ effort: "max", summary: "auto", mode: "pro" });
  });

  it("preserves an explicit Pro mode on a base model", () => {
    const { body } = transform("gpt-5.6-terra", {
      reasoning: { effort: "max", mode: "pro" },
    });
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.reasoning).toEqual({ effort: "max", mode: "pro", summary: "auto" });
  });

  it("rejects undeclared GPT-5.6 modes", () => {
    expect(() => transform("gpt-5.6-luna", { reasoning: { mode: "turbo" } }))
      .toThrow('Unsupported reasoning mode "turbo" for Codex model "gpt-5.6-luna"');
  });

  it("routes compact Pro requests independently and keeps the upstream model id", () => {
    const { body, executor } = transform("gpt-5.6-sol-pro", {
      _compact: true,
      reasoning_effort: "xhigh",
    });
    expect(executor.buildUrl(body.model, true)).toBe("https://chatgpt.com/backend-api/codex/responses/compact");
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.reasoning).toEqual({ effort: "xhigh", summary: "auto", mode: "pro" });
  });

  it("does not leak compact endpoint state into the next normal request", async () => {
    const calls = [];
    const fetchSpy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response([
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta","delta":"OK"}',
        "",
      ].join("\n"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    try {
      const executor = new CodexExecutor();
      await executor.execute({
        model: "gpt-5.6-sol-pro",
        body: { model: "gpt-5.6-sol-pro", input: "compact", _compact: true, reasoning_effort: "max" },
        stream: true,
        credentials: { accessToken: "test" },
      });
      await executor.execute({
        model: "gpt-5.6-sol",
        body: { model: "gpt-5.6-sol", input: "normal", reasoning_effort: "xhigh" },
        stream: true,
        credentials: { accessToken: "test" },
      });
    } finally {
      fetchSpy.mockRestore();
    }

    expect(calls.map(({ url }) => url)).toEqual([
      "https://chatgpt.com/backend-api/codex/responses/compact",
      "https://chatgpt.com/backend-api/codex/responses",
    ]);
    expect(calls[0].body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "max", mode: "pro", summary: "auto" },
    });
    expect(calls[1].body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "xhigh", summary: "auto" },
    });
    expect(calls[1].body.reasoning.mode).toBeUndefined();
  });
});
