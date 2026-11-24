import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const providerId = "openai-compatible-chat-live-test";
let tempDir = "";

async function setupRoute(allowedModels) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-available-live-models-"));
  process.env.DATA_DIR = tempDir;
  globalThis.__availableModelsAllowed = allowedModels;
  vi.resetModules();
  vi.doMock("@/lib/auth/dashboardPermissions", () => ({
    getSessionContext: async () => ({
      session: { role: "apikey", keyName: "test-key", tokenLimit: 0 },
      allowedModels: globalThis.__availableModelsAllowed,
    }),
  }));
  vi.doMock("@/lib/compatibleProviderModels.js", () => ({
    fetchCompatibleProviderModels: async () => ({
      models: [{ id: "wz/gpt-5.6-luna", name: "GPT 5.6 Luna" }],
    }),
  }));

  const { createProviderNode, createProviderConnection } = await import("@/models/index.js");
  await createProviderNode({
    id: providerId,
    type: "openai-compatible",
    name: "Live custom test provider",
    prefix: "openai-acme",
    apiType: "chat",
    baseUrl: "https://compatible.test/v1",
  });
  await createProviderConnection({
    provider: providerId,
    authType: "apikey",
    name: "Live test key",
    apiKey: "test-key",
    defaultModel: "wz/gpt-5.6-luna",
  });

  const { GET } = await import("@/app/api/usage/available-models/route.js");
  return GET;
}

afterEach(() => {
  vi.doUnmock("@/lib/auth/dashboardPermissions");
  vi.doUnmock("@/lib/compatibleProviderModels.js");
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  delete globalThis.__availableModelsAllowed;
});

describe("Available Models route with live custom provider catalogs", () => {
  it("shows a live model under the route prefix allowed by the key", async () => {
    const GET = await setupRoute("openai-acme/wz/gpt-5.6-luna");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      model: "wz/gpt-5.6-luna",
      provider: providerId,
      routedModel: "openai-acme/wz/gpt-5.6-luna",
      origin: "custom",
    });
  });

  it("retains a stored model name when its live catalog returns the same ID", async () => {
    const GET = await setupRoute("openai-acme/wz/gpt-5.6-luna");
    const { addCustomModel } = await import("@/models/index.js");
    await addCustomModel({
      providerAlias: "openai-acme",
      id: "wz/gpt-5.6-luna",
      type: "llm",
      name: "Saved display name",
    });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({ name: "Saved display name", routedModel: "openai-acme/wz/gpt-5.6-luna" });
  });

  it("does not show live custom models outside the key's allowlist", async () => {
    const GET = await setupRoute("openai-acme/wz/other-model");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.callPaths).toBe(0);
  });
});
