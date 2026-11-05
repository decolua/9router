import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const unsupported = () => Response.json({ error: {
  code: "unsupported_parameter", param: "max_tokens",
  message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.",
} }, { status: 400 });
const credentials = { apiKey: "test-key", providerSpecificData: {
  azureEndpoint: "https://example.openai.azure.com", deployment: "production",
} };
const execute = (body, extra = {}) => new AzureExecutor().execute({
  model: "production", body, stream: false, credentials, ...extra,
});
const sentBodies = () => proxyAwareFetch.mock.calls.map(([, init]) => JSON.parse(init.body));

describe("Azure token limits (#4936)", () => {
  it("keeps max_tokens for legacy deployments that accept it", async () => {
    proxyAwareFetch.mockResolvedValue(Response.json({ choices: [] }));
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 2048 };
    await execute(body);
    expect(sentBodies()).toEqual([body]);
  });

  it("renames the limit only after an explicit unsupported-parameter response", async () => {
    proxyAwareFetch.mockResolvedValueOnce(unsupported()).mockResolvedValueOnce(Response.json({ choices: [] }));
    const body = { messages: [{ role: "user", content: "hi" }], max_tokens: 2048 };
    const result = await execute(body);
    expect(result.response.status).toBe(200);
    expect(sentBodies()).toEqual([body, { messages: body.messages, max_completion_tokens: 2048 }]);
    expect(body).toEqual({ messages: [{ role: "user", content: "hi" }], max_tokens: 2048 });
    expect(result.transformedBody).toEqual({ messages: body.messages, max_completion_tokens: 2048 });
    const calls = proxyAwareFetch.mock.calls;
    expect(calls[1][0]).toBe(calls[0][0]);
    expect(calls[1][1].headers).toEqual(calls[0][1].headers);
  });

  it.each([4096, 0])("preserves explicit completion limit %s when both names were supplied", async (limit) => {
    proxyAwareFetch.mockResolvedValueOnce(unsupported()).mockResolvedValueOnce(Response.json({ choices: [] }));
    await execute({ max_tokens: 2048, max_completion_tokens: limit });
    expect(sentBodies()[1]).toEqual({ max_completion_tokens: limit });
  });

  it("returns unrelated 400 responses without retrying or consuming their body", async () => {
    const error = { error: { code: "unsupported_parameter", param: "temperature", message: "unsupported" } };
    proxyAwareFetch.mockResolvedValue(Response.json(error, { status: 400 }));
    const result = await execute({ max_tokens: 2048 });
    expect(sentBodies()).toHaveLength(1);
    expect(await result.response.json()).toEqual(error);
  });

  it("preserves non-JSON 400 responses", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("upstream bad request", { status: 400 }));
    const result = await execute({ max_tokens: 2048 });
    expect(sentBodies()).toHaveLength(1);
    expect(await result.response.text()).toBe("upstream bad request");
  });

  it("does not repeat the compatibility retry when it also fails", async () => {
    proxyAwareFetch.mockImplementation(async () => unsupported());
    const result = await execute({ max_tokens: 2048 });
    expect(result.response.status).toBe(400);
    expect(sentBodies()).toHaveLength(2);
  });

  it("does not retry after the client aborts", async () => {
    const controller = new AbortController();
    proxyAwareFetch.mockImplementationOnce(async () => { controller.abort(); return unsupported(); });
    await execute({ max_tokens: 2048 }, { signal: controller.signal });
    expect(sentBodies()).toHaveLength(1);
  });
});
