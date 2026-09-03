/**
 * Regression test for #1062:
 * GitHub Copilot's /responses endpoint only serves OpenAI (gpt/codex) models.
 * Gemini/Claude models must never be routed/escalated there, otherwise they
 * fail with a misleading 400 "does not support Responses API".
 */

import { describe, it, expect, vi } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { createErrorResult, parseUpstreamError } from "../../open-sse/utils/error.js";

const { proxyFetchMock } = vi.hoisted(() => ({ proxyFetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyFetchMock,
}));

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

describe("GitHub Claude prompt-limit preflight", () => {
  it("rejects an oversized prompt before creating a message", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ input_tokens: 200001 }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const exec = new GithubExecutor();

    const result = await exec.executeWithMessagesEndpoint({
      model: "claude-fable-5",
      body: { messages: [{ role: "user", content: "x".repeat(400000) }] },
      stream: true,
      credentials: { copilotToken: "test-token" },
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    expect(proxyFetchMock.mock.calls[0][0]).toBe("https://api.githubcopilot.com/v1/messages/count_tokens");
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({
      error: { code: "context_length_exceeded" },
    });
  });

  it("does not add token-count latency to small prompts", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    const exec = new GithubExecutor();

    await exec.executeWithMessagesEndpoint({
      model: "claude-fable-5",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      credentials: { copilotToken: "test-token" },
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    expect(proxyFetchMock.mock.calls[0][0]).toBe("https://api.githubcopilot.com/v1/messages");
  });

  it("allows a prompt exactly at the upstream limit", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ input_tokens: 200000 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response("generated", { status: 200 }));
    const exec = new GithubExecutor();

    await exec.executeWithMessagesEndpoint({
      model: "claude-fable-5",
      body: { messages: [{ role: "user", content: "x".repeat(400000) }] },
      stream: true,
      credentials: { copilotToken: "test-token" },
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    expect(proxyFetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.githubcopilot.com/v1/messages/count_tokens",
      "https://api.githubcopilot.com/v1/messages",
    ]);
  });

  it("continues when the token-count endpoint is unavailable", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("generated", { status: 200 }));
    const warn = vi.fn();
    const exec = new GithubExecutor();

    await exec.executeWithMessagesEndpoint({
      model: "claude-fable-5",
      body: { messages: [{ role: "user", content: "x".repeat(400000) }] },
      stream: true,
      credentials: { copilotToken: "test-token" },
      log: { debug: vi.fn(), warn },
    });

    expect(proxyFetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.githubcopilot.com/v1/messages/count_tokens",
      "https://api.githubcopilot.com/v1/messages",
    ]);
    expect(warn).toHaveBeenCalledWith("GITHUB", "Prompt token preflight returned 503; continuing");
  });

  it("preserves context_length_exceeded through default executor parsing", async () => {
    const upstream = new Response(JSON.stringify({
      error: {
        message: "Prompt is 200001 tokens; maximum is 200000.",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
    }), { status: 400, headers: { "content-type": "application/json" } });

    const parsed = await parseUpstreamError(upstream, new GithubExecutor());
    const result = createErrorResult(parsed.statusCode, parsed.message, undefined, parsed.code);

    expect(await result.response.json()).toMatchObject({
      error: {
        message: "Prompt is 200001 tokens; maximum is 200000.",
        code: "context_length_exceeded",
      },
    });
  });
});
