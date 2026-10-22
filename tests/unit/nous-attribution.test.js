import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

const provider = "openai-compatible-chat-nous-test";
const model = "stepfun/step-5-preview:free";
const baseUrl = "https://inference-api.nousresearch.com/v1";
const credentials = { apiKey: "private-test-key", providerSpecificData: { baseUrl, apiType: "chat" } };
const expectedTags = ["product=9router", "client=9router", "user=9router"];
const body = () => ({ model, messages: [{ role: "user", content: "hello" }] });

describe("Nous API-key attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds neutral attribution to API-key requests without putting credentials in tags", () => {
    const original = body();
    const transformed = new DefaultExecutor(provider).transformRequest(model, original, false, credentials);

    expect(transformed.tags).toEqual(expectedTags);
    expect(JSON.stringify(transformed)).not.toContain(credentials.apiKey);
    expect(original.tags).toBeUndefined();
  });

  it("preserves caller tags and identities without adding conflicting defaults", () => {
    const original = { ...body(), tags: ["product=my-app", "client=my-client", "user=alice", "custom=value"] };
    const transformed = new DefaultExecutor(provider).transformRequest(model, original, true, credentials);

    expect(transformed.tags).toEqual(original.tags);
    expect(transformed.tags).not.toBe(original.tags);
  });

  it("fills missing attribution tags and removes empty values", () => {
    const original = { ...body(), tags: ["product=my-app", "user=", "client= ", "custom=value"] };
    const transformed = new DefaultExecutor(provider).transformRequest(model, original, false, credentials);

    expect(transformed.tags).toEqual(["product=my-app", "custom=value", "client=9router", "user=9router"]);
    expect(original.tags).toEqual(["product=my-app", "user=", "client= ", "custom=value"]);
  });

  it.each([
    "https://api.example.test/v1",
    "https://inference-api.nousresearch.com.evil.test/v1",
    "https://inference-api.nousresearch.com@evil.test/v1",
    "http://inference-api.nousresearch.com/v1",
    "not-a-url",
  ])("does not inject tags for a different or invalid endpoint: %s", (url) => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      ...credentials, providerSpecificData: { baseUrl: url, nodeName: "Nous", apiType: "chat" },
    });
    expect(transformed.tags).toBeUndefined();
  });

  it("leaves OAuth-only connections unchanged", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      accessToken: "oauth-token", providerSpecificData: credentials.providerSpecificData,
    });
    expect(transformed.tags).toBeUndefined();
  });

  it("leaves Responses connections unchanged", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      ...credentials, providerSpecificData: { baseUrl, apiType: "responses" },
    });
    expect(transformed.tags).toBeUndefined();
  });

  it("uses the runtime endpoint rather than stale node metadata", () => {
    const executor = new DefaultExecutor(provider);
    const transformed = executor.transformRequest(model, body(), false, {
      ...credentials, runtimeTransport: { baseUrl: "https://other.example.test/chat/completions" },
    });
    expect(transformed.tags).toBeUndefined();
  });

  it("does not tag an actual runtime endpoint using Responses despite a chat node type", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      ...credentials, runtimeTransport: { baseUrl: `${baseUrl}/responses` },
    });
    expect(transformed.tags).toBeUndefined();
  });

  it("tags an actual runtime endpoint using Chat Completions despite a responses node type", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      ...credentials,
      providerSpecificData: { baseUrl, apiType: "responses" },
      runtimeTransport: { baseUrl, urlSuffix: "/chat/completions" },
    });
    expect(transformed.tags).toEqual(expectedTags);
  });

  it("does not use a caller-supplied URL to decide which provider to tag", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, { ...body(), baseUrl }, false, {
      ...credentials, providerSpecificData: { baseUrl: "https://other.example.test/v1", apiType: "chat" },
    });
    expect(transformed.tags).toBeUndefined();
  });

  it.each(["user=alice", { user: "alice" }, 42])("preserves malformed caller tags for upstream validation: %j", (tags) => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, { ...body(), tags }, false, credentials);
    expect(transformed.tags).toEqual(tags);
  });

  it("keeps attribution through the JSON-schema fallback", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, {
      ...body(), response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } },
    }, false, credentials);
    expect(transformed.tags).toEqual(expectedTags);
    expect(transformed.response_format).toEqual({ type: "json_object" });
  });

  it("sends tagged requests through the existing executor without changing authentication", async () => {
    proxyAwareFetch.mockImplementation(async (_url, options) => {
      const requestBody = JSON.parse(options.body);
      const hasUser = requestBody.tags?.some((tag) => tag.startsWith("user=") && tag.length > 5);
      return new Response(JSON.stringify(hasUser ? { choices: [{ message: { content: "OK" } }] }
        : { message: "missing user tag" }), { status: hasUser ? 200 : 400 });
    });
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example.test:8080" };
    const { response } = await new DefaultExecutor(provider).execute({
      model, body: body(), stream: false, credentials, proxyOptions,
    });

    expect(response.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledWith(`${baseUrl}/chat/completions`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${credentials.apiKey}` }),
    }), proxyOptions);
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).tags).toEqual(expectedTags);
  });
});
