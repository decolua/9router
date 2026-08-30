import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-auth-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  const db = await import("@/lib/db/index.js");
  const auth = await import("@/lib/auth/apiKeyAuthorization.js");
  return { db, auth };
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("API key authorization", () => {
  it("keeps keys unrestricted until a policy is configured", async () => {
    const { db, auth } = await setup();
    const key = await db.createApiKey("unrestricted", "machine-1");
    const stored = await auth.resolveApiKeyRecord(key.key);

    expect(auth.canUseModel(stored, "codex", "gpt-5.6-sol")).toBe(true);
    expect(auth.canUseVisionFallback(stored)).toBe(true);
    expect(auth.getAuthorizedConnectionIds(stored, "codex", "gpt-5.6-sol")).toBeNull();
  });

  it("persists per-account chat and image grants", async () => {
    const { db, auth } = await setup();
    const key = await db.createApiKey("restricted", "machine-1");
    const authorization = auth.sanitizeApiKeyAuthorization({
      enabled: true,
      visionFallback: true,
      bareModelFallback: { codex: true, claude: true },
      connections: {
        "codex-a": {
          models: ["codex/gpt-5.6-sol", "codex/gpt-5.6-luna"],
          imageModels: [],
          quotaPercent: 40,
        },
        "openai-b": {
          models: [],
          imageModels: ["openai/gpt-image-1"],
        },
      },
    });
    await db.updateApiKey(key.id, { authorization });
    const stored = await auth.resolveApiKeyRecord(key.key);

    expect(auth.getAuthorizedConnectionIds(stored, "codex", "gpt-5.6-sol")).toEqual(["codex-a"]);
    expect(auth.getApiKeyQuotaPercent(stored, "codex-a")).toBe(40);
    expect(auth.resolveAuthorizedBareModel(stored, "gpt-5.6-sol")).toBe("cx/gpt-5.6-sol");
    expect(auth.resolveAuthorizedBareModel(stored, "claude-opus-5")).toBeNull();
    expect(auth.canUseModel(stored, "deepseek", "deepseek-chat")).toBe(false);
    expect(auth.getAuthorizedConnectionIds(stored, "openai", "gpt-image-1", auth.API_KEY_MODEL_KIND.IMAGE)).toEqual(["openai-b"]);
    expect(auth.canUseVisionFallback(stored)).toBe(true);
  });

  it("selects only accounts granted for the requested model", async () => {
    const { db } = await setup();
    const first = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "first", accessToken: "a" });
    const second = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "second", accessToken: "b" });
    const { getProviderCredentials } = await import("@/sse/services/auth.js");

    const credentials = await getProviderCredentials("codex", null, "gpt-5.6-sol", {
      allowedConnectionIds: [second.id],
    });

    expect(credentials.connectionId).toBe(second.id);
    expect(credentials.connectionId).not.toBe(first.id);
  });

  it("rejects a direct model outside the configured whitelist", async () => {
    const { db, auth } = await setup();
    const key = await db.createApiKey("restricted", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: auth.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          "codex-a": { models: ["codex/gpt-5.6-sol"], imageModels: [] },
        },
      }),
    });
    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] }),
    }));

    expect(response.status).toBe(403);
  });

  it("filters the OpenAI model list to direct grants only", async () => {
    const { db, auth } = await setup();
    const connection = await db.createProviderConnection({ provider: "codex", authType: "oauth", name: "codex", accessToken: "a" });
    const apiKeyRecord = {
      authorization: auth.sanitizeApiKeyAuthorization({
        enabled: true,
        visionFallback: true,
        connections: {
          [connection.id]: {
            models: ["codex/gpt-5.6-sol", "codex/gpt-5.6-luna"],
            imageModels: [],
          },
        },
      }),
    };
    const { filterModelsForApiKey } = await import("@/app/api/v1/models/route.js");
    const filtered = await filterModelsForApiKey([
      { id: "cx/gpt-5.6-sol" },
      { id: "cx/gpt-5.6-luna" },
      { id: "deepseek/deepseek-chat" },
    ], apiKeyRecord, auth.API_KEY_MODEL_KIND.LLM);

    expect(filtered.map((model) => model.id)).toEqual(["cx/gpt-5.6-sol", "cx/gpt-5.6-luna"]);
  });

  it("requires the vision-fallback capability before using the global adapter", async () => {
    const { db, auth } = await setup();
    const key = await db.createApiKey("restricted", "machine-1");
    await db.updateSettings({
      capacityAdapter: {
        vision: { enabled: true, roundRobin: false, models: ["codex/gpt-5.6-luna"] },
      },
    });
    await db.updateApiKey(key.id, {
      authorization: auth.sanitizeApiKeyAuthorization({
        enabled: true,
        visionFallback: false,
        connections: {
          "deepseek-a": { models: ["deepseek/deepseek-chat"], imageModels: [] },
        },
      }),
    });
    const { handleChat } = await import("@/sse/handlers/chat.js");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "data:image/png;base64,aA==" } },
          ],
        }],
      }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Vision fallback is not authorized for this API key" },
    });
  });

  it("rejects image generation outside the image-model whitelist", async () => {
    const { db, auth } = await setup();
    const key = await db.createApiKey("restricted", "machine-1");
    await db.updateApiKey(key.id, {
      authorization: auth.sanitizeApiKeyAuthorization({
        enabled: true,
        connections: {
          "openai-a": { models: [], imageModels: ["openai/gpt-image-1"] },
        },
      }),
    });
    const { handleImageGeneration } = await import("@/sse/handlers/imageGeneration.js");
    const response = await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "openai/dall-e-3", prompt: "cat" }),
    }));

    expect(response.status).toBe(403);
  });
});
