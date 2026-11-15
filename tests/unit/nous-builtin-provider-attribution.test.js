import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

// The built-in registry provider (open-sse/providers/registry/nous.js) resolves
// `nous/<model>` to provider id "nous" — NOT to an "openai-compatible-*"
// connection. Its transport points straight at NOUS_CHAT_COMPLETIONS_URL.
const provider = "nous";
const model = "upstage/solar-mini4:free";
const expectedTags = ["product=9router", "client=9router", "user=9router"];
const body = () => ({ model, messages: [{ role: "user", content: "hello" }] });

// API-key credentials for the built-in provider: the registry provider carries
// its own baseUrl, so the caller supplies the key and nothing else.
const credentials = { apiKey: "private-test-key" };

describe("Nous built-in provider attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds attribution tags for the built-in nous provider", () => {
    const original = body();
    const transformed = new DefaultExecutor(provider).transformRequest(model, original, false, credentials);

    expect(transformed.tags).toEqual(expectedTags);
    expect(original.tags).toBeUndefined();
  });

  it("does not put the credential into the tags", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, credentials);

    expect(JSON.stringify(transformed)).not.toContain(credentials.apiKey);
  });

  it("preserves caller-supplied attribution identities", () => {
    const original = { ...body(), tags: ["product=my-app", "client=my-client", "user=alice"] };
    const transformed = new DefaultExecutor(provider).transformRequest(model, original, false, credentials);

    expect(transformed.tags).toEqual(original.tags);
    expect(transformed.tags).not.toBe(original.tags);
  });

  it("fills only the missing attribution tags", () => {
    const original = { ...body(), tags: ["product=my-app", "custom=value"] };
    const transformed = new DefaultExecutor(provider).transformRequest(model, original, false, credentials);

    expect(transformed.tags).toEqual(["product=my-app", "custom=value", "client=9router", "user=9router"]);
  });

  it("leaves OAuth-only connections unchanged", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      accessToken: "oauth-token",
    });

    expect(transformed.tags).toBeUndefined();
  });

  it("does not tag a built-in nous provider pointed at a different endpoint", () => {
    const transformed = new DefaultExecutor(provider).transformRequest(model, body(), false, {
      ...credentials,
      runtimeTransport: { baseUrl: "https://other.example.test/chat/completions" },
    });

    expect(transformed.tags).toBeUndefined();
  });

  it("sends the tagged request to the Nous chat-completions endpoint", async () => {
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
    expect(JSON.parse(proxyAwareFetch.mock.calls[0][1].body).tags).toEqual(expectedTags);
  });
});
