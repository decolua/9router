import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractApiKeyMock, getScopeMock, getModelInfoMock, getComboModelsMock } = vi.hoisted(() => ({
  extractApiKeyMock: vi.fn(),
  getScopeMock: vi.fn(),
  getModelInfoMock: vi.fn(),
  getComboModelsMock: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: extractApiKeyMock,
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyScopeByKey: getScopeMock,
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: getModelInfoMock,
  getComboModels: getComboModelsMock,
}));

const { withScopeAuth } = await import("../../src/middleware/scopeAuth.js");

function jsonRequest(body) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("withScopeAuth", () => {
  beforeEach(() => {
    extractApiKeyMock.mockReset();
    getScopeMock.mockReset();
    getModelInfoMock.mockReset();
    getComboModelsMock.mockReset();
    getComboModelsMock.mockResolvedValue(null);
  });

  it("passes through untouched when no API key is present (back-compat)", async () => {
    extractApiKeyMock.mockReturnValue(null);
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withScopeAuth(handler);

    const req = jsonRequest({ model: "anthropic/claude-sonnet-4-5" });
    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(getScopeMock).not.toHaveBeenCalled();
    expect(await res.text()).toBe("ok");
  });

  it("passes through untouched when the key has no scope (back-compat)", async () => {
    extractApiKeyMock.mockReturnValue("sk-abc");
    getScopeMock.mockResolvedValue(null);
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withScopeAuth(handler);

    await wrapped(jsonRequest({ model: "anthropic/claude-sonnet-4-5" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls the handler exactly once and forwards an unconsumed body when allowed", async () => {
    extractApiKeyMock.mockReturnValue("sk-scoped");
    getScopeMock.mockResolvedValue({ providers: ["anthropic"], models: [] });
    getModelInfoMock.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-4-5" });
    const handler = vi.fn(async (req) => {
      const body = await req.json();
      return Response.json({ echoed: body.model });
    });
    const wrapped = withScopeAuth(handler);

    const res = await wrapped(jsonRequest({ model: "anthropic/claude-sonnet-4-5" }));
    expect(handler).toHaveBeenCalledTimes(1);
    const data = await res.json();
    expect(data.echoed).toBe("anthropic/claude-sonnet-4-5");
  });

  it("returns 403 and never calls the handler when the model is out of scope", async () => {
    extractApiKeyMock.mockReturnValue("sk-scoped");
    getScopeMock.mockResolvedValue({ providers: ["anthropic"], models: [] });
    getModelInfoMock.mockResolvedValue({ provider: "openai", model: "gpt-4" });
    const handler = vi.fn(async () => new Response("should not run"));
    const wrapped = withScopeAuth(handler);

    const res = await wrapped(jsonRequest({ model: "openai/gpt-4" }));
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it("denies a combo when any member model falls outside scope", async () => {
    extractApiKeyMock.mockReturnValue("sk-scoped");
    getScopeMock.mockResolvedValue({ providers: ["anthropic"], models: [] });
    getComboModelsMock.mockResolvedValue(["anthropic/claude-sonnet-4-5", "openai/gpt-4"]);
    getModelInfoMock.mockImplementation(async (m) => {
      const [provider, model] = m.split("/");
      return { provider, model };
    });
    const handler = vi.fn(async () => new Response("should not run"));
    const wrapped = withScopeAuth(handler);

    const res = await wrapped(jsonRequest({ model: "my-combo" }));
    expect(handler).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it("fails open (calls handler) when body parsing is ambiguous", async () => {
    extractApiKeyMock.mockReturnValue("sk-scoped");
    getScopeMock.mockResolvedValue({ providers: ["anthropic"], models: [] });
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withScopeAuth(handler);

    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    await wrapped(req);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("checks the provider/model pair using pseudoModelId for search-style endpoints", async () => {
    extractApiKeyMock.mockReturnValue("sk-scoped");
    getScopeMock.mockResolvedValue({ providers: ["brave"], models: [] });
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withScopeAuth(handler, { bodyMode: "json-provider", pseudoModelId: "search" });

    const allowed = await wrapped(jsonRequest({ provider: "brave" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(allowed.status).not.toBe(403);

    handler.mockClear();
    const denied = await wrapped(jsonRequest({ provider: "tavily" }));
    expect(handler).not.toHaveBeenCalled();
    expect(denied.status).toBe(403);
  });
});
