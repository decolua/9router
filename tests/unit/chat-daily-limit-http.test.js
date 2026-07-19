import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
}));
const modelMocks = vi.hoisted(() => ({
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
}));
const dispatchMocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", async (importOriginal) => ({
  ...await importOriginal(),
  getProviderCredentials: authMocks.getProviderCredentials,
}));
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let apiKey;
let unlimitedApiKey;
let postChat;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-limit-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const db = await import("@/lib/db/index.js");
  await db.initDb();
  apiKey = await db.createApiKey("exhausted-key", "machine-test", 100);
  unlimitedApiKey = await db.createApiKey("unlimited-key", "machine-test");
  await db.saveRequestUsage({
    provider: "openai",
    model: "gpt-4o",
    apiKey: apiKey.key,
    tokens: { prompt_tokens: 60, completion_tokens: 30, reasoning_tokens: 20 },
  });

  ({ POST: postChat } = await import("@/app/api/v1/chat/completions/route.js"));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(() => vi.clearAllMocks());

describe("POST /v1/chat/completions daily token admission", () => {
  it("returns 429 before provider selection or upstream dispatch for an exhausted active key", async () => {
    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [] }),
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        message: "API key daily token limit exceeded (110/100 tokens)",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    });
    expect(modelMocks.getComboModels).not.toHaveBeenCalled();
    expect(modelMocks.getModelInfo).not.toHaveBeenCalled();
    expect(authMocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(dispatchMocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("allows an unlimited active key to reach account selection and dispatch", async () => {
    const credentials = {
      connectionId: "connection-test",
      connectionName: "test-account",
      authType: "apikey",
      apiKey: "provider-key",
      providerSpecificData: {},
    };
    modelMocks.getComboModels.mockResolvedValue(null);
    modelMocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
    authMocks.getProviderCredentials.mockResolvedValue(credentials);
    dispatchMocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ id: "chat-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const response = await postChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${unlimitedApiKey.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "openai/gpt-4o", messages: [] }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "chat-test" });
    expect(modelMocks.getComboModels).toHaveBeenCalledWith("openai/gpt-4o");
    expect(modelMocks.getModelInfo).toHaveBeenCalledWith("openai/gpt-4o");
    expect(authMocks.getProviderCredentials).toHaveBeenCalledWith("openai", expect.any(Set), "gpt-4o");
    expect(dispatchMocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: unlimitedApiKey.key,
      credentials: expect.objectContaining({ connectionId: "connection-test" }),
    }));
  });
});
