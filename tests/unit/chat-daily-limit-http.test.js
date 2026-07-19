import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  getProviderCredentials: vi.fn(),
  isValidApiKey: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));
const modelMocks = vi.hoisted(() => ({
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
}));
const dispatchMocks = vi.hoisted(() => ({
  handleChatCore: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => "sk-..."),
  warn: vi.fn(),
}));

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let apiKey;
let postChat;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-limit-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const db = await import("@/lib/db/index.js");
  await db.initDb();
  apiKey = await db.createApiKey("exhausted-key", "machine-test", 100);
  await db.saveRequestUsage({
    provider: "openai",
    model: "gpt-4o",
    apiKey: apiKey.key,
    tokens: { prompt_tokens: 60, completion_tokens: 30, reasoning_tokens: 20 },
  });

  authMocks.extractApiKey.mockReturnValue(apiKey.key);
  authMocks.isValidApiKey.mockResolvedValue(true);
  ({ POST: postChat } = await import("@/app/api/v1/chat/completions/route.js"));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

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
});
