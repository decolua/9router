import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderNode, setModelAlias, createCombo } = await import("@/models/index.js");
  const { getModelInfo, resolveBareHarnessModel } = await import("@/sse/services/model.js");

  return {
    createProviderNode,
    setModelAlias,
    createCombo,
    getModelInfo,
    resolveBareHarnessModel,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("model routing", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });

  it("adds cx/ only when bare Codex fallback is enabled and authorized", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const key = {
      authorization: {
        enabled: true,
        bareModelFallback: { codex: true, claude: false },
        connections: {
          codex1: { models: ["codex/gpt-5.6-sol"], imageModels: [] },
        },
      },
    };

    await expect(ctx.resolveBareHarnessModel("gpt-5.6-sol", key)).resolves.toBe("cx/gpt-5.6-sol");
    await expect(ctx.resolveBareHarnessModel("gpt-5.6-luna", key)).resolves.toBe("gpt-5.6-luna");
  });

  it("keeps custom aliases and combos ahead of bare-model fallback", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;
    const key = {
      authorization: {
        enabled: true,
        bareModelFallback: { codex: true },
        connections: {
          codex1: { models: ["codex/gpt-5.6-sol"], imageModels: [] },
        },
      },
    };
    await ctx.setModelAlias("gpt-5.6-sol", "ds/deepseek-chat");
    await expect(ctx.resolveBareHarnessModel("gpt-5.6-sol", key)).resolves.toBe("gpt-5.6-sol");

    await ctx.createCombo({ name: "gpt-5.6-luna", models: ["cx/gpt-5.6-sol"] });
    await expect(ctx.resolveBareHarnessModel("gpt-5.6-luna", key)).resolves.toBe("gpt-5.6-luna");
  });
});
