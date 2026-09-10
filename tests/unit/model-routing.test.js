import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderNode } = await import("@/models/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    createProviderNode,
    getModelInfo,
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

  it("routes to custom node when its prefix collides with a built-in provider alias", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // User explicitly creates a custom node with prefix "cf" (cloudflare-ai alias).
    // Credentials are stored under the node ID, so routing must go to the node,
    // not the built-in provider (which would have no credentials).
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
        provider: "openai-compatible-chat-test",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("routes to custom node when prefix matches built-in tokenrouter alias (tr)", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // Reproduces: user creates a custom openai-compatible node named "tokenrouter"
    // with prefix "tr". The built-in provider "tokenrouter" also has alias "tr".
    // Previously, the reserved-prefix guard skipped the custom node lookup and
    // routed to the built-in provider, which had no credentials →
    // "No active credentials for provider: tokenrouter".
    await ctx.createProviderNode({
      id: "openai-compatible-chat-tr-node",
      type: "openai-compatible",
      name: "tokenrouter",
      prefix: "tr",
      apiType: "chat",
      baseUrl: "https://api.tokenrouter.com/v1",
    });

    await expect(ctx.getModelInfo("tr/qwen/qwen3.8-max-free"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-tr-node",
        model: "qwen/qwen3.8-max-free",
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
});
