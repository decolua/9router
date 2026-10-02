import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getSettings: vi.fn(), getCombos: vi.fn(), getModelAliases: vi.fn(), updateSettings: vi.fn(), validateApiKey: vi.fn(), buildModelsList: vi.fn() }));
const search = vi.hoisted(() => ({ handleSearch: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/app/api/v1/models/route", () => ({ buildModelsList: db.buildModelsList }));
vi.mock("@/sse/handlers/search.js", () => search);
const { GET, PUT } = await import("../../src/app/api/chatgpt/route.js");
const { getChatGPTManifest, routeChatGPTResponse } = await import("../../src/lib/chatgpt/endpoint.js");
const { selectChatGPTModels } = await import("../../src/lib/chatgpt/models.js");
const { openCompactionSummary } = await import("../../src/lib/chatgpt/compact.js");

const available = [
  { id: "glm/glm-5.3", context_length: 202752, capabilities: { tools: true, vision: false } },
  { id: "gpt-6-astra", capabilities: { tools: true, vision: true } },
  { id: "Coding", capabilities: { tools: true } },
  { id: "no-tools", capabilities: { tools: false } },
];
const selected = selectChatGPTModels(["glm/glm-5.3", "gpt-6-astra", "Coding"], available);
function request(body, extra = {}, signal) {
  return new Request("http://router/api/chatgpt/v1/responses", {
    method: "POST", headers: { authorization: "Bearer router-key", "content-type": "application/json", ...extra },
    body: JSON.stringify(body), signal,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  db.getSettings.mockResolvedValue({ chatgptIntegration: { models: selected } });
  db.getCombos.mockResolvedValue([]);
  db.getModelAliases.mockResolvedValue({});
  db.buildModelsList.mockImplementation(async kind => kind?.[0] === "webSearch"
    ? [{ id: "brave-search/search", kind: "webSearch" }, { id: "glm/search", kind: "webSearch" }]
    : available);
  search.handleSearch.mockReset();
  db.validateApiKey.mockImplementation(async key => key === "router-key");
});

describe("ChatGPT integration settings and catalog", () => {
  it("persists validated model IDs and limits, including combos", async () => {
    const result = await PUT(request({ models: ["Coding", "glm/glm-5.3"] }));
    expect(result.status).toBe(200);
    expect(db.updateSettings).toHaveBeenCalledWith({ chatgptIntegration: { models: [selected[2], selected[0]], webSearchModel: "" } });
    expect((await (await GET()).json()).limit).toBe(5);
  });
  it.each([["missing"], ["Coding", "Coding"], Array(6).fill("Coding"), ["no-tools"], null])("rejects invalid selection %j", async models => {
    const result = await PUT(request({ models }));
    expect(result.status).toBe(400);
    expect(db.updateSettings).not.toHaveBeenCalled();
  });
  it("separates router models from native model names", async () => {
    const res = await getChatGPTManifest(request({}));
    const data = await res.json();
    expect(data.models.map(m => m.slug)).toEqual(["9router/glm/glm-5.3", "9router/gpt-6-astra", "9router/Coding"]);
    expect(data.models[0].contextWindow).toBe(202752);
    expect(data.models[0].reasoningLevels).toEqual(["low", "high", "max"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("refreshes reasoning for already saved Combo selections without requiring another save", async () => {
    db.getCombos.mockResolvedValue([{ name: "Coding", models: ["glm/glm-5.3", "ds/deepseek-flash"] }]);
    const first = await (await getChatGPTManifest(request({}))).json();
    expect(first.models[2].reasoningLevels).toEqual(["high", "max"]);
    db.getCombos.mockResolvedValue([{ name: "Coding", models: ["glm/glm-5.3"] }]);
    const second = await (await getChatGPTManifest(request({}))).json();
    expect(second.models[2].reasoningLevels).toEqual(["low", "high", "max"]);
    expect(db.updateSettings).not.toHaveBeenCalled();
  });
  it("refreshes vision and context for saved selections from the live catalog", async () => {
    db.getSettings.mockResolvedValue({ chatgptIntegration: { models: [{
      id: "gpt-6-astra", name: "old name", contextWindow: 32768, imageInput: false,
    }, {
      id: "temporarily-missing", name: "Missing", contextWindow: 65536, imageInput: true,
    }] } });
    db.buildModelsList.mockImplementation(async kind => kind?.[0] === "webSearch" ? [] : [{
      id: "gpt-6-astra", name: "Astra", context_length: 400000,
      capabilities: { tools: true, vision: true },
    }]);

    const data = await (await getChatGPTManifest(request({}))).json();
    expect(data.models[0]).toMatchObject({
      id: "gpt-6-astra", name: "Astra", contextWindow: 400000, imageInput: true,
    });
    expect(data.models[1]).toMatchObject({
      id: "temporarily-missing", contextWindow: 65536, imageInput: true,
    });
    expect(db.updateSettings).not.toHaveBeenCalled();
  });
  it.each([{ authorization: "Bearer invalid" }, { authorization: "" }, { "chatgpt-account-id": "account" }])("rejects non-router credentials %j", async headers => {
    expect((await getChatGPTManifest(request({}, headers))).status).toBe(401);
    const handler = vi.fn();
    expect((await routeChatGPTResponse(request({ model: "9router/Coding" }, headers), handler)).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("ChatGPT Responses production adapter", () => {
  it.each([false, true])("forwards string input without requiring hosted search (stream=%s)", async stream => {
    const response = Response.json({ status: "completed" });
    const handler = vi.fn(async routed => {
      expect(await routed.json()).toMatchObject({ model: "Coding", input: "Reply with OK.", stream });
      return response;
    });
    expect(await routeChatGPTResponse(request({ model: "9router/Coding", input: "Reply with OK.", stream }), handler))
      .toBe(response);
    expect(handler).toHaveBeenCalledOnce();
    expect(search.handleSearch).not.toHaveBeenCalled();
  });

  it("routes to handleChat with only router auth and propagates the original stream", async () => {
    const source = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: response.output_text.delta\ndata: {"delta":"hello"}\n\n'));
      controller.close();
    } });
    const response = new Response(source, { headers: { "content-type": "text/event-stream" } });
    const handler = vi.fn(async req => {
      expect(Object.fromEntries(req.headers)).toEqual({ authorization: "Bearer router-key", "content-type": "application/json" });
      expect(await req.json()).toEqual({ model: "Coding", input: [], tools: [{ type: "function", name: "exec_command" }], stream: true });
      return response;
    });
    const result = await routeChatGPTResponse(request({ model: "9router/Coding", input: [], tools: [{ type: "function", name: "exec_command" }], stream: true }, {
      cookie: "private-cookie", "x-session-token": "private-token", "openai-organization": "private-org",
    }), handler);
    expect(result).toBe(response);
    expect(await result.text()).toContain('"delta":"hello"');
  });
  it("builds a portable compacted history and propagates cancellation", async () => {
    const abort = new AbortController();
    let forwarded;
    const handler = vi.fn(async req => { forwarded = req; return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Changed app.js; tests passed." }] }] }); });
    const result = await routeChatGPTResponse(request({ model: "9router/Coding", input: [] }, {}, abort.signal), handler, true);
    expect(await forwarded.json()).toMatchObject({ model: "Coding", stream: false, max_output_tokens: 8192 });
    const compacted = await result.json();
    expect(compacted).toMatchObject({ object: "response.compaction", output: [{ type: "compaction", encrypted_content: expect.any(String) }] });
    expect(openCompactionSummary(compacted.output[0].encrypted_content, "router-key")).toBe("Changed app.js; tests passed.");
    abort.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });
  it.each([{ output: [] }, { status: "incomplete", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "partial" }] }] }])("does not replace history after unsuccessful compaction %j", async completion => {
    const result = await routeChatGPTResponse(request({ model: "9router/Coding", input: [] }), async () => Response.json(completion), true);
    expect(result.status).toBe(502);
  });
  it("saves an explicit web-search backend for Codex's hosted web_search tool", async () => {
    const result = await PUT(request({ models: ["Coding"], webSearchModel: "glm/search" }));
    expect(result.status).toBe(200);
    expect(db.updateSettings).toHaveBeenCalledWith({ chatgptIntegration: { models: [selected[2]], webSearchModel: "glm/search" } });
    expect((await PUT(request({ models: ["Coding"], webSearchModel: "not/search" }))).status).toBe(400);
  });

  it("executes hosted web_search through 9router and returns a Responses SSE result", async () => {
    const payloads = [];
    let searchRequest;
    const handler = vi.fn(async req => {
      payloads.push(await req.json());
      if (payloads.length === 1) {
        return Response.json({
          id: "resp_search", object: "response", status: "completed",
          output: [{ id: "fc_search", type: "function_call", call_id: "call_search", name: "web_search", arguments: JSON.stringify({ query: "codex web search" }) }],
        });
      }
      return Response.json({
        id: "resp_answer", object: "response", status: "completed",
        output: [{ id: "msg_answer", type: "message", role: "assistant", content: [{ type: "output_text", text: "Found current docs." }] }],
      });
    });
    search.handleSearch.mockResolvedValue(Response.json({
      provider: "brave-search", query: "codex web search",
      results: [{ title: "Codex", url: "https://example.com/codex", snippet: "Responses API" }],
    }));

    const result = await routeChatGPTResponse(request({
      model: "9router/Coding", input: [{ role: "user", content: [{ type: "input_text", text: "Search current docs" }] }],
      tools: [{ type: "web_search", search_context_size: "medium" }], stream: true,
    }), handler);

    expect(result.headers.get("content-type")).toContain("text/event-stream");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(payloads[0]).toMatchObject({ stream: false, tools: [{ type: "function", name: "web_search" }] });
    expect(payloads[1].input.at(-1)).toMatchObject({ type: "function_call_output", call_id: "call_search" });
    expect(search.handleSearch).toHaveBeenCalledTimes(1);
    searchRequest = search.handleSearch.mock.calls[0][0];
    expect(searchRequest.url).toBe("http://router/v1/search");
    expect(searchRequest.headers.get("authorization")).toBe("Bearer router-key");
    expect(await searchRequest.json()).toMatchObject({ provider: "brave-search/search", query: "codex web search" });
    const text = await result.text();
    expect(text).toContain("response.output_item.added");
    expect(text).toContain("\"type\":\"web_search_call\"");
    expect(text).toContain("Found current docs.");
    expect(text).toContain("response.completed");
  });

  it.each(["gpt-6-astra", "9router/missing", null])("does not route disabled or unprefixed models: %s", async model => {
    const handler = vi.fn();
    expect((await routeChatGPTResponse(request({ model }), handler)).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
  it.each([{ previous_response_id: "resp_other_backend" }, { input: [{ type: "item_reference", id: "opaque" }] }])("rejects opaque history %j", async history => {
    const handler = vi.fn();
    expect((await routeChatGPTResponse(request({ model: "9router/Coding", ...history }), handler)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
