import { describe, expect, it } from "vitest";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";

describe("Credential object immutability and security isolation", () => {
  it("does not mutate original credentials object with per-request rawHeaders in chatCore", async () => {
    const originalCredentials = { connectionId: "conn-999", apiKey: "test-key" };
    const frozenCopy = { ...originalCredentials };

    const clientRawRequest = {
      endpoint: "/v1/chat/completions",
      body: { messages: [{ role: "user", content: "Warmup" }] },
      headers: { "x-sensitive-user-header": "secret-value-123" },
    };

    // Fast-path bypass request (Warmup + claude-cli) to trigger handleChatCore setup without network
    await handleChatCore({
      body: { messages: [{ role: "user", content: "Warmup" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: originalCredentials,
      clientRawRequest,
      userAgent: "claude-cli/1.0.0",
    });

    expect(originalCredentials.rawHeaders).toBeUndefined();
    expect(originalCredentials.runtimeTransport).toBeUndefined();
    expect(originalCredentials._clientSessionId).toBeUndefined();
    expect(originalCredentials).toEqual(frozenCopy);
  });

  it("ensures two requests sharing a credentials object receive isolated request metadata", async () => {
    const sharedCredentials = { connectionId: "conn-shared", apiKey: "test-key" };

    const requestA = {
      endpoint: "/v1/chat/completions",
      body: { messages: [{ role: "user", content: "Warmup" }] },
      headers: { cookie: "user-a-session=123" },
    };

    const requestB = {
      endpoint: "/v1/chat/completions",
      body: { messages: [{ role: "user", content: "Warmup" }] },
      headers: { cookie: "user-b-session=456" },
    };

    await handleChatCore({
      body: { messages: [{ role: "user", content: "Warmup" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: sharedCredentials,
      clientRawRequest: requestA,
      userAgent: "claude-cli/1.0.0",
    });

    await handleChatCore({
      body: { messages: [{ role: "user", content: "Warmup" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: sharedCredentials,
      clientRawRequest: requestB,
      userAgent: "claude-cli/1.0.0",
    });

    expect(sharedCredentials.rawHeaders).toBeUndefined();
  });

  it("does not mutate input credentials object in VertexExecutor", async () => {
    const executor = new VertexExecutor();
    const originalCredentials = { apiKey: "test-key" };

    // Build headers using credentials
    const headers = executor.buildHeaders(originalCredentials, false);
    expect(headers).toBeDefined();
    expect(originalCredentials.accessToken).toBeUndefined();
  });
});
