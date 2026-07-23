import { describe, expect, it, vi } from "vitest";

import {
  CodexExecutor,
  getExecutor,
  hasSpecializedExecutor,
} from "../../open-sse/executors/index.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sseResponse(text = "OK") {
  return new Response([
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`,
    "",
  ].join("\n"), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Codex executor lifecycle", () => {
  it("creates Codex per request while preserving other executor caches", () => {
    const firstCodex = getExecutor("codex");
    const secondCodex = getExecutor("codex");
    const firstGithub = getExecutor("github");
    const secondGithub = getExecutor("github");
    const firstDefault = getExecutor("custom-provider");
    const secondDefault = getExecutor("custom-provider");

    expect(firstCodex).toBeInstanceOf(CodexExecutor);
    expect(secondCodex).toBeInstanceOf(CodexExecutor);
    expect(firstCodex).not.toBe(secondCodex);
    expect(firstGithub).toBe(secondGithub);
    expect(firstDefault).toBe(secondDefault);
    expect(hasSpecializedExecutor("codex")).toBe(true);
    expect(hasSpecializedExecutor("custom-provider")).toBe(false);
  });

  it("keeps compact routes and session headers isolated under forced interleaving", async () => {
    const compactExecutor = getExecutor("codex");
    const normalExecutor = getExecutor("codex");
    const compactPrefetchStarted = deferred();
    const releaseCompactPrefetch = deferred();
    const calls = [];

    compactExecutor.prefetchImages = vi.fn(async () => {
      compactPrefetchStarted.resolve();
      await releaseCompactPrefetch.promise;
    });
    normalExecutor.prefetchImages = vi.fn(async () => {});

    const fetchSpy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url, init) => {
      calls.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      return sseResponse(url.endsWith("/compact") ? "compact" : "normal");
    });

    try {
      const compactPromise = compactExecutor.execute({
        model: "gpt-5.6-sol-pro",
        body: {
          model: "gpt-5.6-sol-pro",
          input: "compact",
          prompt_cache_key: "compact-session",
          _compact: true,
          reasoning_effort: "max",
        },
        stream: true,
        credentials: {
          accessToken: "test",
          connectionId: "compact-connection",
        },
      });

      await compactPrefetchStarted.promise;

      await normalExecutor.execute({
        model: "gpt-5.6-sol",
        body: {
          model: "gpt-5.6-sol",
          input: "normal",
          prompt_cache_key: "normal-session",
          reasoning_effort: "xhigh",
        },
        stream: true,
        credentials: {
          accessToken: "test",
          connectionId: "normal-connection",
        },
      });

      releaseCompactPrefetch.resolve();
      await compactPromise;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: { session_id: "normal-session" },
      body: {
        prompt_cache_key: "normal-session",
        model: "gpt-5.6-sol",
      },
    });
    expect(calls[1]).toMatchObject({
      url: "https://chatgpt.com/backend-api/codex/responses/compact",
      headers: { session_id: "compact-session" },
      body: {
        prompt_cache_key: "compact-session",
        model: "gpt-5.6-sol",
      },
    });
    expect(calls[0].body.reasoning).toEqual({
      effort: "xhigh",
      summary: "auto",
    });
    expect(calls[1].body.reasoning).toEqual({
      effort: "max",
      summary: "auto",
      mode: "pro",
    });
  });
});
