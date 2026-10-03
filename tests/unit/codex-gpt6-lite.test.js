import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

const credentials = { connectionId: "fixture", accessToken: "fixture-token" };
afterEach(() => vi.restoreAllMocks());

describe("Codex GPT-6 Sol/Luna transport", () => {
  it.each(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"])("lists %s with Codex capabilities", (model) => {
    const entry = getModelsByProviderId("codex").find((item) => item.id === model);
    expect(entry?.responsesLite).toBe(true);
    expect(entry?.thinkingLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getCapabilitiesForModel("codex", model)).toMatchObject({
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 272000,
      maxOutput: 128000,
    });
    expect(getThinkingLevels("codex", model)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getThinkingLevels("codex", `${model}(high)`)).toEqual(entry.thinkingLevels);
  });

  it("uses official OpenAI Standard pricing for GPT-6", () => {
    expect(getPricingForModel("codex", "gpt-6-astra")).toMatchObject({ input: 10, cached: 1, cache_creation: 12.5, output: 50 });
    expect(getPricingForModel("codex", "gpt-6-sol")).toMatchObject({ input: 2, cached: 0.2, cache_creation: 2.5, output: 10 });
    expect(getPricingForModel("codex", "gpt-6-luna")).toMatchObject({ input: 0.1, cached: 0.01, cache_creation: 0.125, output: 0.5 });
  });

  it("keeps a native Responses Lite request intact", () => {
    const executor = new CodexExecutor();
    const input = [
      { type: "additional_tools", role: "developer", tools: [{ type: "function", name: "run", parameters: { type: "object", properties: {} } }] },
      { type: "message", id: "msg_native", role: "developer", content: [{ type: "input_text", text: "Native instructions" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    ];
    const body = executor.transformRequest("gpt-6-luna", {
      model: "gpt-6-luna", input: structuredClone(input), instructions: "", tools: null, parallel_tool_calls: false,
      reasoning: { effort: "high", context: "all_turns" },
    }, true, credentials);
    const headers = executor.buildHeaders(credentials, true, null, "gpt-6-luna");

    expect(headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    expect(body.instructions).toBe("");
    expect(body.tools).toBeNull();
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.input).toEqual(input);
    expect(body.reasoning).toEqual({ effort: "high", context: "all_turns" });
  });

  it.each(["gpt-6-sol", "gpt-6-luna"])("keeps hosted web_search available on %s", async (model) => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    await new CodexExecutor().execute({
      model,
      body: {
        model, input: "Search the web", tools: [
          { type: "function", name: "run", parameters: { type: "object", properties: {} } },
          { type: "web_search" },
        ], tool_choice: "none",
      },
      stream: true, credentials,
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(body.tools).toEqual([
      { type: "function", name: "run", parameters: { type: "object", properties: {} } },
      { type: "web_search" },
    ]);
    expect(body.input.some(item => item.type === "additional_tools")).toBe(false);
    expect(body.tool_choice).toBe("none");
  });

  it.each(["gpt-6-sol", "gpt-6-luna"])("registers auto-injected hosted search on %s", async (model) => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    await new CodexExecutor().execute({
      model,
      body: { model, input: "Search the web", _autoCodexWebSearch: true },
      stream: true, credentials,
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input.some(item => item.type === "additional_tools")).toBe(false);
  });

  it("moves hosted search out of a native Lite prefix", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    const tool = { type: "function", name: "run", parameters: { type: "object", properties: {} } };
    await new CodexExecutor().execute({
      model: "gpt-6-sol",
      body: { model: "gpt-6-sol", input: [
        { type: "additional_tools", role: "developer", tools: [tool, { type: "web_search" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "search" }] },
      ], tools: null, tool_choice: "none" },
      stream: true, credentials,
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(body.tools).toEqual([tool, { type: "web_search" }]);
    expect(body.input.some(item => item.type === "additional_tools")).toBe(false);
    expect(body.tool_choice).toBe("none");
  });

  it("preserves native Lite developer instructions when switching for hosted search", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({ ok: true, status: 200, headers: new Map() });
    const instruction = { type: "message", role: "developer", content: [{ type: "input_text", text: "Only answer in French" }] };
    await new CodexExecutor().execute({
      model: "gpt-6-sol", body: { model: "gpt-6-sol", input: [
        { type: "additional_tools", role: "developer", tools: [{ type: "web_search" }] },
        instruction,
        { type: "message", role: "user", content: [{ type: "input_text", text: "search" }] },
      ], instructions: "", tools: null }, stream: true, credentials,
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toContainEqual(instruction);
    expect(body.instructions).toBe("");
    expect(body.tools).toEqual([{ type: "web_search" }]);
  });

  it("does not duplicate tools when hosted search appears in both tool locations", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({ ok: true, status: 200, headers: new Map() });
    const tool = { type: "function", name: "run", parameters: { type: "object", properties: {} } };
    await new CodexExecutor().execute({
      model: "gpt-6-sol", body: { model: "gpt-6-sol", input: [
        { type: "additional_tools", role: "developer", tools: [tool, { type: "web_search" }] },
        { type: "additional_tools", role: "developer", tools: [tool] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "search" }] },
      ], tools: [tool, { type: "web_search" }] }, stream: true, credentials,
    });
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(body.tools).toEqual([tool, { type: "web_search" }]);
    expect(body.input.some(item => item.type === "additional_tools")).toBe(false);
  });

  it("converts an ordinary Responses request to the Lite shape", () => {
    const executor = new CodexExecutor();
    const tool = { type: "function", name: "run", parameters: { type: "object", properties: {} } };
    const body = executor.transformRequest("gpt-6-sol", {
      model: "gpt-6-sol", input: "hello", instructions: "Do the task", tools: [tool],
    }, true, credentials);

    expect(body.instructions).toBe("");
    expect(body.tools).toBeNull();
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.reasoning).toEqual({ effort: "medium", context: "all_turns" });
    expect(body.input[0]).toEqual({ type: "additional_tools", role: "developer", tools: [tool] });
    expect(body.input[1]).toEqual({ type: "message", role: "developer", content: [{ type: "input_text", text: "Do the task" }] });
    expect(executor.buildHeaders(credentials, true, null, "gpt-6-sol")["x-openai-internal-codex-responses-lite"]).toBe("true");
  });

  it("clamps unsupported GPT-6 reasoning values to Codex's lowest supported level", () => {
    const body = new CodexExecutor().transformRequest("gpt-6-luna", {
      model: "gpt-6-luna", input: "hello", reasoning: { effort: "none" },
    }, true, credentials);

    expect(body.reasoning.effort).toBe("low");
    expect(body.reasoning.context).toBe("all_turns");
  });

  it("maps GPT-6.1 Sol's Codex-only ultra effort to max", () => {
    const body = new CodexExecutor().transformRequest("gpt-6.1-sol", {
      model: "gpt-6.1-sol", input: "hello", reasoning: { effort: "ultra" },
    }, true, credentials);

    expect(body.reasoning).toEqual({ effort: "max", context: "all_turns" });
  });

  it("sends the Lite shape and header in the actual outbound request", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    await new CodexExecutor().execute({
      model: "gpt-6-luna",
      body: { model: "gpt-6-luna", input: "hello", instructions: "Do the task" },
      stream: true,
      credentials,
    });

    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(options.headers["x-openai-internal-codex-responses-lite"]).toBe("true");
    expect(options.headers.version).toBe("0.159.0");
    expect(options.headers["User-Agent"]).toBe("codex_cli_rs/0.159.0");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.instructions).toBe("");
    expect(body.input[0].type).toBe("additional_tools");
    expect(body.reasoning.context).toBe("all_turns");
  });

  it("keeps the legacy transport for other models", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.5", { model: "gpt-5.5", input: "hello" }, true, credentials);

    expect(body.instructions).toBeTruthy();
    expect(body.input[0].type).not.toBe("additional_tools");
    expect(body.reasoning.context).toBeUndefined();
    expect(executor.buildHeaders(credentials, true, null, "gpt-5.5")["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    expect(getThinkingLevels("codex", "gpt-6-astra")).toContain("none");
    expect(executor.buildHeaders(credentials, true, null, "gpt-6-astra")["x-openai-internal-codex-responses-lite"]).toBeUndefined();
  });
});
