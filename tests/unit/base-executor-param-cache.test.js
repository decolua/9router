import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

async function readParamCache(dataDir) {
  const filePath = join(dataDir, "param_fixes.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}

describe("BaseExecutor parameter cache persistence", () => {
  let dataDir;
  let previousDataDir;

  afterEach(async () => {
    vi.useRealTimers();
    vi.doUnmock("../../open-sse/utils/proxyFetch.js");
    vi.doUnmock("../../open-sse/utils/atomicWrite.js");
    vi.resetModules();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
  });

  it("persists learned fixes asynchronously after retrying with replacement token param", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;

    const proxyAwareFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "unsupported_parameter",
          param: "max_tokens",
          message: "Unsupported parameter: max_tokens. Use max_completion_tokens instead."
        }
      }), { status: 400, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

    const { BaseExecutor, flushParamCacheSaveForTests } = await import("../../open-sse/executors/base.js");
    const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });
    const body = { messages: [], max_tokens: 5 };

    const result = await executor.execute({
      model: "model-a",
      body,
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(result.response.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(proxyAwareFetch.mock.calls[1][1].body)).toEqual({
      messages: [],
      max_completion_tokens: 5
    });
    expect(body).toEqual({ messages: [], max_tokens: 5 });

    await flushParamCacheSaveForTests();
    const cache = await readParamCache(dataDir);
    expect(cache["openai-compatible-test:model-a"]).toEqual({
      max_tokens: "max_completion_tokens"
    });
    expect((await readdir(dataDir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("cancels the original 400 response body before auto-fix retrying", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;

    const cancel = vi.fn().mockResolvedValue(undefined);
    const firstResponse = {
      status: 400,
      headers: {
        get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null
      },
      body: { cancel },
      bodyUsed: false,
      clone: () => ({
        text: () => Promise.resolve(JSON.stringify({
          error: {
            code: "unsupported_parameter",
            param: "max_tokens",
            message: "Unsupported parameter: max_tokens. Use max_completion_tokens instead."
          }
        }))
      })
    };
    const proxyAwareFetch = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

    const { BaseExecutor, flushParamCacheSaveForTests } = await import("../../open-sse/executors/base.js");
    const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });

    const result = await executor.execute({
      model: "model-a",
      body: { messages: [], max_tokens: 5 },
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(result.response.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(proxyAwareFetch.mock.invocationCallOrder[1]);
    await flushParamCacheSaveForTests();
  });

  it("retries pending param cache saves after transient write failures", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;

    const proxyAwareFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "unsupported_parameter",
          param: "max_tokens",
          message: "Unsupported parameter: max_tokens. Use max_completion_tokens instead."
        }
      }), { status: 400, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));
    vi.doMock("../../open-sse/utils/atomicWrite.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        writeJsonFileAtomically: vi.fn()
          .mockRejectedValueOnce(new Error("temporary write failure"))
          .mockImplementation((...args) => actual.writeJsonFileAtomically(...args))
      };
    });

    const { BaseExecutor, flushParamCacheSaveForTests } = await import("../../open-sse/executors/base.js");
    const { writeJsonFileAtomically } = await import("../../open-sse/utils/atomicWrite.js");
    const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });

    const result = await executor.execute({
      model: "model-a",
      body: { messages: [], max_tokens: 5 },
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(result.response.status).toBe(200);

    await flushParamCacheSaveForTests();
    const cache = await readParamCache(dataDir);
    expect(cache["openai-compatible-test:model-a"]).toEqual({
      max_tokens: "max_completion_tokens"
    });
    expect(writeJsonFileAtomically).toHaveBeenCalledTimes(2);
  });

  it("waits for an already in-flight param cache save before returning", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;

    const proxyAwareFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "unsupported_parameter",
          param: "max_tokens",
          message: "Unsupported parameter: max_tokens. Use max_completion_tokens instead."
        }
      }), { status: 400, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    let releaseWrite;
    const writeCanFinish = new Promise(resolve => {
      releaseWrite = resolve;
    });

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));
    vi.doMock("../../open-sse/utils/atomicWrite.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        writeJsonFileAtomically: vi.fn(async (...args) => {
          await writeCanFinish;
          return actual.writeJsonFileAtomically(...args);
        })
      };
    });

    vi.useFakeTimers();
    const { BaseExecutor, flushParamCacheSaveForTests } = await import("../../open-sse/executors/base.js");
    const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });

    const result = await executor.execute({
      model: "model-a",
      body: { messages: [], max_tokens: 5 },
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(result.response.status).toBe(200);

    vi.advanceTimersByTime(250);
    const flushPromise = flushParamCacheSaveForTests();
    let flushReturned = false;
    flushPromise.then(() => {
      flushReturned = true;
    });

    vi.advanceTimersByTime(0);
    expect(flushReturned).toBe(false);

    releaseWrite();
    await flushPromise;
    vi.useRealTimers();

    const cache = await readParamCache(dataDir);
    expect(cache["openai-compatible-test:model-a"]).toEqual({
      max_tokens: "max_completion_tokens"
    });
  });

  it("learns replacement token params from plain-text unsupported-parameter errors", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;

    const proxyAwareFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(
        "Unsupported parameter: max_tokens. Use max_completion_tokens instead.",
        { status: 400, headers: { "Content-Type": "text/plain" } }
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

    const { BaseExecutor, flushParamCacheSaveForTests } = await import("../../open-sse/executors/base.js");
    const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });

    const result = await executor.execute({
      model: "model-a",
      body: { messages: [], max_tokens: 5 },
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(result.response.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(proxyAwareFetch.mock.calls[1][1].body)).toEqual({
      messages: [],
      max_completion_tokens: 5
    });

    await flushParamCacheSaveForTests();
    const cache = await readParamCache(dataDir);
    expect(cache["openai-compatible-test:model-a"]).toEqual({
      max_tokens: "max_completion_tokens"
    });
  });

  it("bounds chained auto-fix retries with maxAutoFixAttempts", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;

    const unsupportedParamResponse = (param) => new Response(JSON.stringify({
      error: {
        code: "unsupported_parameter",
        param,
        message: `Unsupported parameter: ${param}.`
      }
    }), { status: 400, headers: { "Content-Type": "application/json" } });
    const proxyAwareFetch = vi
      .fn()
      .mockResolvedValueOnce(unsupportedParamResponse("param_a"))
      .mockResolvedValueOnce(unsupportedParamResponse("param_b"))
      .mockResolvedValueOnce(unsupportedParamResponse("param_c"));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

    const { BaseExecutor, flushParamCacheSaveForTests } = await import("../../open-sse/executors/base.js");
    const executor = new BaseExecutor("openai-compatible-test", {
      baseUrl: "https://example.test/v1",
      maxAutoFixAttempts: 2
    });

    const result = await executor.execute({
      model: "model-a",
      body: { messages: [], param_a: "a", param_b: "b", param_c: "c" },
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(result.response.status).toBe(400);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toEqual({
      messages: [],
      param_a: "a",
      param_b: "b",
      param_c: "c"
    });
    expect(JSON.parse(proxyAwareFetch.mock.calls[1][1].body)).toEqual({
      messages: [],
      param_b: "b",
      param_c: "c"
    });
    expect(JSON.parse(proxyAwareFetch.mock.calls[2][1].body)).toEqual({
      messages: [],
      param_c: "c"
    });

    await flushParamCacheSaveForTests();
    const cache = await readParamCache(dataDir);
    expect(cache["openai-compatible-test:model-a"]).toEqual({
      param_a: null,
      param_b: null
    });
  });

  it("preserves an already-present replacement param when applying cached fixes", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;
    await writeFile(join(dataDir, "param_fixes.json"), JSON.stringify({
      "openai-compatible-test:model-a": {
        max_tokens: "max_completion_tokens"
      }
    }));

    const proxyAwareFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new BaseExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });
    const body = { messages: [], max_tokens: 5, max_completion_tokens: 11 };

    await executor.execute({
      model: "model-a",
      body,
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toEqual({
      messages: [],
      max_completion_tokens: 11
    });
    expect(body).toEqual({ messages: [], max_tokens: 5, max_completion_tokens: 11 });
  });

  it("applies cached fixes before transformRequest derives provider-specific fields", async () => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = await mkdtemp(join(tmpdir(), "9router-param-cache-"));
    process.env.DATA_DIR = dataDir;
    await writeFile(join(dataDir, "param_fixes.json"), JSON.stringify({
      "openai-compatible-test:model-a": {
        max_tokens: "max_completion_tokens"
      }
    }));

    const proxyAwareFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    class DerivedParamExecutor extends BaseExecutor {
      transformRequest(model, body) {
        if (body.max_tokens !== undefined) {
          return { providerParams: { unsupportedMaxTokens: body.max_tokens } };
        }
        return { providerParams: { supportedMaxCompletionTokens: body.max_completion_tokens } };
      }
    }

    const executor = new DerivedParamExecutor("openai-compatible-test", { baseUrl: "https://example.test/v1" });
    const body = { messages: [], max_tokens: 5 };

    await executor.execute({
      model: "model-a",
      body,
      stream: false,
      credentials: { apiKey: "test-key" },
      log: null
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body)).toEqual({
      providerParams: { supportedMaxCompletionTokens: 5 }
    });
    expect(body).toEqual({ messages: [], max_tokens: 5 });
  });
});
