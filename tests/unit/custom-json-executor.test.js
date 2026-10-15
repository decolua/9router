import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
import { DefaultExecutor } from "open-sse/executors/default.js";
import { getTargetFormat } from "open-sse/services/provider.js";
import { normalizeCustomJsonConfig, buildCustomJsonRequest, extractCustomJsonText } from "open-sse/utils/customJson.js";

const endpoint = "https://api.example.com/api/run?version=2";
const provider = "openai-compatible-custom-json-test";
const body = { messages: [{ role: "user", content: 'Example "input"\n基础' }], project_id: "demo-project" };
const config = (overrides = {}) => ({
  method: "POST", authType: "bearer", authHeader: "X-API-Key", headers: { "X-App": "9router" },
  requestTemplate: { project_id: "{{prompt}}", history: "{{messages}}", model: "{{model}}", stream: "{{stream}}" },
  responsePath: "data.answers[0].text", ...overrides,
});
const credentials = (customJson = config(), apiType = "custom-json") => ({ apiKey: "test-secret", providerSpecificData: { baseUrl: endpoint, apiType, customJson } });
const execute = (stream = false, customJson = config(), options = {}) => new DefaultExecutor(provider).execute({
  model: "custom-model", body: structuredClone(body), stream, credentials: credentials(customJson), ...options,
});
afterEach(() => vi.unstubAllGlobals());

describe("custom JSON template configuration", () => {
  it("preserves typed placeholders and safely interpolates quotes, newlines and Unicode", () => {
    const c = normalizeCustomJsonConfig(config({ requestTemplate: {
      ...config().requestTemplate, name: "{{request.project_id}}", greeting: "Input: {{prompt}}", enabled: true, limit: 3,
    } }), endpoint);
    const result = buildCustomJsonRequest(c, "assistant", body);
    expect(result).toEqual({ project_id: body.messages[0].content, history: body.messages, model: "assistant", stream: false,
      name: "demo-project", greeting: `Input: ${body.messages[0].content}`, enabled: true, limit: 3 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it("uses the most recent user text parts even when a tool or assistant follows", () => {
    const result = buildCustomJsonRequest(config(), "assistant", { messages: [
      { role: "user", content: "old" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: {} }, { type: "text", text: "world" }] },
      { role: "assistant", content: "reply" },
    ] });
    expect(result.project_id).toBe("hello\nworld");
  });
  it.each([
    ["requestTemplate", []], ["requestTemplate", { x: "{{secret}}" }], ["requestTemplate", { x: "{{request.__proto__}}" }],
    ["requestTemplate", JSON.parse('{"__proto__":{"polluted":true}}')], ["requestTemplate", { x: "{{prompt}" }],
    ["responsePath", "data.*"], ["responsePath", "constructor"], ["headers", { Authorization: "secret" }],
    ["headers", { "X-App": "x\r\ny" }], ["method", "TRACE"], ["authType", "unknown"],
  ])("rejects invalid %s configuration", (field, value) => {
    expect(() => normalizeCustomJsonConfig(config({ [field]: value }), endpoint)).toThrow();
  });
  it.each(["file:///etc/passwd", "https://user:secret@example.com", "javascript:alert(1)", "https://example.com/#fragment"])("rejects invalid endpoint %s", (url) => {
    expect(() => normalizeCustomJsonConfig(config(), url)).toThrow();
  });
  it("fails missing runtime variables instead of silently omitting required fields", () => {
    expect(() => buildCustomJsonRequest(config({ requestTemplate: { project_id: "{{request.missing}}" } }), "x", body)).toThrow("Missing template value");
  });
  it("extracts array fields and serializes JSON values, including false and zero", () => {
    expect(extractCustomJsonText(config(), { data: { answers: [{ text: "OK" }] } })).toBe("OK");
    for (const value of [false, 0, { project: "demo-project" }]) expect(extractCustomJsonText({ responsePath: "$" }, value)).toBe(JSON.stringify(value));
    expect(() => extractCustomJsonText(config(), {})).toThrow("Response field not found");
  });
});

describe("custom JSON upstream execution", () => {
  it("uses the full URL, configured method/auth and mapped payload, then normalizes the response", async () => {
    const fetch = vi.fn(async () => Response.json({ data: { answers: [{ text: "示例回复" }] } }));
    vi.stubGlobal("fetch", fetch);
    const result = await execute(false, config({ method: "PATCH", authType: "api-key", authHeader: "X-Service-Key" }));
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(options.method).toBe("PATCH");
    expect(options.headers).toMatchObject({ "X-Service-Key": "test-secret", "X-App": "9router", Accept: "application/json" });
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(result.headers["X-Service-Key"]).toBe("[REDACTED]");
    expect(JSON.parse(options.body)).toMatchObject({ project_id: body.messages[0].content, history: body.messages, stream: false });
    expect((await result.response.json()).choices[0].message.content).toBe("示例回复");
    expect(getTargetFormat(provider, credentials())).toBe("openai");
  });
  it("returns complete SSE framing to streaming clients while requesting JSON upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { answers: [{ text: "hello\nworld" }] } })));
    const { response } = await execute(true);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const frames = (await response.text()).trim().split("\n\n");
    expect(JSON.parse(frames[0].slice(6)).choices[0].delta.content).toBe("hello\nworld");
    expect(JSON.parse(frames[1].slice(6)).choices[0].finish_reason).toBe("stop");
    expect(frames[2]).toBe("data: [DONE]");
  });
  it("honors a node edited from chat to custom JSON, despite its immutable ID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { answers: [{ text: "OK" }] } })));
    const executor = new DefaultExecutor("openai-compatible-chat-legacy");
    expect(executor.buildUrl("x", false, 0, credentials())).toBe(endpoint);
    expect((await (await executor.execute({ body, model: "x", stream: false, credentials: credentials() })).response.json()).choices[0].message.content).toBe("OK");
  });
  it("supports no authentication without sending a placeholder key", async () => {
    const fetch = vi.fn(async () => Response.json({ answer: "OK" })); vi.stubGlobal("fetch", fetch);
    await execute(false, config({ authType: "none", responsePath: "answer" }), { credentials: { providerSpecificData: credentials(config({ authType: "none", responsePath: "answer" })).providerSpecificData } });
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });
  it.each([429, 502, 503, 504])("preserves upstream %s errors without replaying a business action", async (status) => {
    const fetch = vi.fn(async () => Response.json({ error: "business error" }, { status })); vi.stubGlobal("fetch", fetch);
    const { response } = await execute();
    expect(response.status).toBe(status); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not replay network failures", async () => {
    const fetch = vi.fn(async () => { throw new Error("network failure"); }); vi.stubGlobal("fetch", fetch);
    await expect(execute()).rejects.toThrow("network failure"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([() => new Response("<html>not JSON</html>"), () => Response.json({ unexpected: true })])("reports malformed or unmappable responses as 502", async (response) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const result = await execute(); expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.message).toContain("Custom JSON response:");
  });
  it("passes cancellation to upstream fetch", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort(new DOMException("cancelled", "AbortError"));
    })));
    await expect(execute(false, config(), { signal: controller.signal })).rejects.toThrow("cancelled");
  });
});
