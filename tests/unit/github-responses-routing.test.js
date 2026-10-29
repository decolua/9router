/**
 * Regression test for #1062:
 * GitHub Copilot's /responses endpoint only serves OpenAI (gpt/codex) models.
 * Gemini/Claude models must never be routed/escalated there, otherwise they
 * fail with a misleading 400 "does not support Responses API".
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("GithubExecutor.supportsResponsesEndpoint", () => {
  const exec = new GithubExecutor();

  it("excludes Gemini models from the /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("gemini-3.1-pro-preview")).toBe(false);
    expect(exec.supportsResponsesEndpoint("gemini-3.1-pro-low")).toBe(false);
  });

  it("excludes Claude models from the /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("claude-sonnet-4.6")).toBe(false);
    expect(exec.supportsResponsesEndpoint("claude-opus-4.7")).toBe(false);
  });

  it("allows OpenAI/codex models on the /responses endpoint", () => {
    expect(exec.supportsResponsesEndpoint("gpt-5.5-codex")).toBe(true);
    expect(exec.supportsResponsesEndpoint("o4-mini")).toBe(true);
    expect(exec.supportsResponsesEndpoint("gpt-4.1")).toBe(true);
  });

  it("is null-safe", () => {
    expect(exec.supportsResponsesEndpoint(undefined)).toBe(true);
    expect(exec.supportsResponsesEndpoint("")).toBe(true);
  });
});

describe("GithubExecutor.execute cached-route guard (#1062)", () => {
  it("does NOT use /responses for a Gemini model even if it was wrongly cached as codex", async () => {
    const exec = new GithubExecutor();
    // Simulate a prior misclassification that cached the Gemini model.
    exec.knownCodexModels.add("gemini-3.1-pro-preview");

    const respSpy = vi
      .spyOn(exec, "executeWithResponsesEndpoint")
      .mockResolvedValue({ via: "responses" });
    // Short-circuit the /chat/completions path (BaseExecutor.execute).
    const baseSpy = vi
      .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(exec)), "execute")
      .mockResolvedValue({ response: { status: 200 }, via: "chat" });

    const result = await exec.execute({ model: "gemini-3.1-pro-preview", body: { messages: [] }, log: null });

    expect(respSpy).not.toHaveBeenCalled();
    expect(baseSpy).toHaveBeenCalled();
    expect(result.via).toBe("chat");
  });

});

describe("GithubExecutor unsupported params on upstream routes", () => {
  const cases = ["gpt-5.4", "gpt-6.1-sol"].flatMap(model =>
    ["chat", "fallback", "cached"].map(route => ({ model, route }))
  );

  it.each(cases)("strips temperature for $model on the $route route", async ({ model, route }) => {
    const exec = new GithubExecutor();
    const body = {
      model,
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.7,
    };
    if (route === "cached") exec.knownCodexModels.add(model);
    if (route === "fallback") {
      proxyAwareFetch.mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: "not accessible via the /chat/completions endpoint" } }),
        { status: 400 }
      ));
    }
    proxyAwareFetch.mockResolvedValueOnce(new Response("data: [DONE]\n\n", { status: 200 }));

    const result = await exec.execute({
      model, body, stream: true, credentials: { accessToken: "test-token" },
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(route === "fallback" ? 2 : 1);
    for (const [, options] of proxyAwareFetch.mock.calls) {
      const sent = JSON.parse(options.body);
      expect(sent).not.toHaveProperty("temperature");
      expect(sent.model).toBe(model);
    }
    expect(result.url).toBe(route === "chat" ? exec.config.baseUrl : exec.config.responsesUrl);
    expect(body.temperature).toBe(0.7);
    if (route !== "chat") {
      expect(result.transformedBody.input).toEqual([{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      }]);
    }
  });

  it.each([
    { model: "gpt-6.1-sol", stripTemperature: true },
    { model: "gpt-5.3-codex", stripTemperature: false },
  ])("filters an already-Responses-format request for $model", async ({ model, stripTemperature }) => {
    const exec = new GithubExecutor();
    exec.knownCodexModels.add(model);
    const body = {
      input: [{ role: "user", content: "hello" }],
      temperature: 0.7,
      max_output_tokens: 1024,
    };
    proxyAwareFetch.mockResolvedValueOnce(new Response("data: [DONE]\n\n", { status: 200 }));

    await exec.execute({ model, body, stream: true, credentials: { accessToken: "test-token" } });

    const sent = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    if (stripTemperature) expect(sent).not.toHaveProperty("temperature");
    else expect(sent.temperature).toBe(0.7);
    expect(sent.input).toEqual(body.input);
    expect(sent.max_output_tokens).toBe(1024);
    expect(body.temperature).toBe(0.7);
  });
});
