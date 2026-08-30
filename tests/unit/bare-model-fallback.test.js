import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setup(provider, model, bareModelFallback) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bare-model-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const auth = await import("@/lib/auth/apiKeyAuthorization.js");
  const connection = await db.createProviderConnection({ provider, authType: "oauth", name: provider, accessToken: `${provider}-token` });
  const key = await db.createApiKey("test", "machine-1");
  await db.updateApiKey(key.id, {
    authorization: auth.sanitizeApiKeyAuthorization({
      enabled: true,
      bareModelFallback,
      connections: {
        [connection.id]: { models: [`${provider}/${model}`], imageModels: [] },
      },
    }),
  });
  return { key };
}

beforeEach(() => {
  mocks.handleChatCore.mockReset();
  mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok", { status: 200 }) });
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("bare model fallback", () => {
  it("routes an allowed bare gpt-* model through Codex", async () => {
    const { key } = await setup("codex", "gpt-5.6-sol", { codex: true });
    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: "hi" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0]).toMatchObject({
      modelInfo: { provider: "codex", model: "gpt-5.6-sol" },
      body: { model: "codex/gpt-5.6-sol" },
    });
  });

  it("routes an allowed bare claude-* model through Claude Code", async () => {
    const { key } = await setup("claude", "claude-opus-5", { claude: true });
    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key.key },
      body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls[0][0]).toMatchObject({
      modelInfo: { provider: "claude", model: "claude-opus-5" },
      body: { model: "claude/claude-opus-5" },
    });
  });

  it("keeps legacy behavior when the toggle is absent", async () => {
    const { key } = await setup("codex", "gpt-5.6-sol", {});
    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "gpt-5.6-sol", input: "hi" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
