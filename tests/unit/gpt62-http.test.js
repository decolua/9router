import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import * as upstream from "../../open-sse/utils/proxyFetch.js";

const state = vi.hoisted(() => ({ connections: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false, rtkEnabled: false, headroomEnabled: false }),
  getProviderConnections: async (filter = {}) => state.connections.filter(c => !filter.provider || c.provider === filter.provider),
  getProviderConnectionById: async id => state.connections.find(c => c.id === id),
  updateProviderConnection: async () => ({}),
  validateApiKey: async () => true,
  getProxyPools: async () => [],
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getCustomModels: async () => [],
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}),
}));
const responses = await import("../../src/app/api/v1/responses/route.js");
const chat = await import("../../src/app/api/v1/chat/completions/route.js");

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unexpected external fetch"); });
  state.connections = [
    { id: "codex-fixture", provider: "codex", isActive: true, accessToken: "oauth-fixture", expiresAt: "2099-01-01T00:00:00.000Z", providerSpecificData: {} },
    { id: "api-fixture", provider: "openai", isActive: true, apiKey: "api-fixture", providerSpecificData: {} },
  ];
});
afterEach(() => vi.restoreAllMocks());

function request(path, body) {
  return new Request(`http://fixture.invalid/v1/${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-session-id": "gpt62-fixture" }, body: JSON.stringify(body),
  });
}
const reasoningHistory = {
  type: "reasoning", encrypted_content: "gAAAAA_fixture_reasoning",
  summary: [{ type: "summary_text", text: "Fixture reasoning summary" }],
};
function completed(model, tool = false) {
  const output = tool ? [{ ...structuredClone(reasoningHistory), id: "rs_fixture" }, { type: "function_call", id: "fc_fixture", call_id: "call_fixture", name: "run", arguments: "{}", status: "completed" }]
    : [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: "fixture answer", annotations: [] }] }];
  const response = { id: "resp_fixture", object: "response", model, status: "completed", output, usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } };
  const events = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    ...output.map((item, output_index) => ({ type: "response.output_item.added", output_index, item })),
    ...(tool ? [{ type: "response.function_call_arguments.delta", item_id: "fc_fixture", output_index: 1, delta: "{}" }]
      : [{ type: "response.output_text.delta", item_id: "msg_fixture", output_index: 0, content_index: 0, delta: "fixture answer" }]),
    ...output.map((item, output_index) => ({ type: "response.output_item.done", output_index, item })),
    { type: "response.completed", response },
  ];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}
function fakeCodex(id, effort, options = {}) {
  return vi.spyOn(upstream, "proxyAwareFetch").mockImplementation(async (url, init) => {
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init.headers.Authorization).toBe("Bearer oauth-fixture");
    expect(init.headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.model).toBe(id);
    expect(body.reasoning.effort).toBe(effort);
    expect(body.reasoning.summary).toBe("auto");
    expect(body.reasoning.context).toBeUndefined();
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    if (options.search) expect(body.tools).toContainEqual({ type: "web_search" });
    if (options.second) {
      const history = body.input.filter(item => item.type === "reasoning");
      if (!isDeepStrictEqual(history, [reasoningHistory])) {
        return new Response('{"error":{"message":"fixture reasoning history rejected"}}', { status: 400, headers: { "content-type": "application/json" } });
      }
      expect(body.input).toContainEqual({ type: "function_call_output", call_id: "call_fixture", output: "fixture result" });
    }
    if (options.reject) return new Response(JSON.stringify({ error: { message: "fixture model rejected", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
    return completed(id, options.tool);
  });
}

for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
  for (const prefix of ["cx", "codex"]) {
    for (const level of [null, ...getThinkingLevels("codex", id)]) {
      it(`${prefix}/${id}${level ? `(${level})` : ""}: HTTP Responses reaches only OAuth`, async () => {
        const entry = getProviderModels("cx").find(m => m.id === id);
        expect(entry).toBeDefined();
        const mock = fakeCodex(id, level || "low");
        const response = await responses.POST(request("responses", { model: `${prefix}/${entry.id}${level ? `(${level})` : ""}`, input: "Hello fixture", stream: true }));
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("fixture answer");
        expect(text).toContain("response.completed");
        expect(mock).toHaveBeenCalledTimes(1);
      });
    }
  }
  it(`${id}: HTTP Responses tool result uses first response output`, async () => {
    let mock = fakeCodex(id, "high", { tool: true });
    const response = await responses.POST(request("responses", { model: `cx/${id}(high)`, input: "Use run", tools: [{ type: "function", name: "run", parameters: { type: "object", properties: {} } }], stream: true }));
    expect(response.status).toBe(200);
    const frames = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const done = frames.find(e => e.type === "response.completed");
    expect(done.response.output).toContainEqual({ ...reasoningHistory, id: "rs_fixture" });
    expect(done.response.output).toContainEqual(expect.objectContaining({ type: "function_call", call_id: "call_fixture", name: "run", arguments: "{}" }));
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockRestore();
    mock = fakeCodex(id, "high", { second: true, search: true });
    const second = await responses.POST(request("responses", { model: `cx/${id}(high)`, input: [...done.response.output, { type: "function_call_output", call_id: "call_fixture", output: "fixture result" }], tools: [{ type: "web_search" }], stream: true }));
    expect(second.status).toBe(200);
    expect(await second.text()).toContain("fixture answer");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  for (const corruption of ["missing", "encrypted_content", "summary"]) {
    it(`${id}: second turn rejects ${corruption} reasoning beside accepted history`, async () => {
      const mock = fakeCodex(id, "high", { tool: true });
      const first = await responses.POST(request("responses", { model: `cx/${id}(high)`, input: "Use run", stream: true }));
      const frames = (await first.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
      const history = frames.find(event => event.type === "response.completed").response.output;
      expect(history).toContainEqual({ ...reasoningHistory, id: "rs_fixture" });
      mock.mockRestore();
      const secondMock = fakeCodex(id, "high", { second: true });
      const send = input => responses.POST(request("responses", { model: `cx/${id}(high)`, input: [...input, { type: "function_call_output", call_id: "call_fixture", output: "fixture result" }], stream: true }));
      const accepted = await send(structuredClone(history));
      expect(accepted.status).toBe(200);
      expect(await accepted.text()).toContain("fixture answer");
      const changed = structuredClone(history);
      const index = changed.findIndex(item => item.type === "reasoning");
      if (corruption === "missing") changed.splice(index, 1);
      else if (corruption === "encrypted_content") changed[index].encrypted_content = "gAAAAA_corrupted";
      else changed[index].summary[0].text = "Corrupted summary";
      const rejected = await send(changed);
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      expect(await rejected.text()).toContain("fixture reasoning history rejected");
      expect(secondMock).toHaveBeenCalledTimes(2);
    });
  }
  it(`${id}: HTTP Chat nonstream translates the real Codex SSE`, async () => {
    const mock = fakeCodex(id, "low");
    const response = await chat.POST(request("chat/completions", { model: `cx/${id}`, messages: [{ role: "user", content: "Hello fixture" }], stream: false }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("fixture answer");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it(`${id}: HTTP rejection cannot become a fallback success`, async () => {
    const mock = fakeCodex(id, "low", { reject: true });
    const response = await responses.POST(request("responses", { model: `cx/${id}`, input: "Hello fixture", stream: true }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain("fixture model rejected");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it(`${id}: explicit API selects Chat Completions, never Codex`, async () => {
    const mock = vi.spyOn(upstream, "proxyAwareFetch").mockImplementation(async (url, init) => {
      if (url !== "https://api.openai.com/v1/chat/completions" || init.headers.Authorization !== "Bearer api-fixture") {
        return new Response('{"error":{"message":"unexpected fixture destination"}}', { status: 400, headers: { "content-type": "application/json" } });
      }
      const chunks = [
        { id: "api_fixture", object: "chat.completion.chunk", model: id, choices: [{ index: 0, delta: { role: "assistant", content: "api fixture answer" }, finish_reason: null }] },
        { id: "api_fixture", object: "chat.completion.chunk", model: id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    });
    const response = await chat.POST(request("chat/completions", { model: `openai/${id}(high)`, messages: [{ role: "user", content: "Hello fixture" }], stream: true }));
    expect(response.status).toBe(200);
    const text = await response.text();
    const chunks = text.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    expect(chunks.map(chunk => chunk.choices?.[0]?.delta?.content || "").join("")).toBe("api fixture answer");
    expect(text).toContain("data: [DONE]");
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer api-fixture");
    expect(JSON.parse(init.body)).toMatchObject({ model: id, reasoning_effort: "high", stream: true });
  });
}
