import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalFetch = globalThis.fetch;
const CHUTES_MODELS_URL = "https://llm.chutes.ai/v1/models";

function mockNextResponse() {
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
}

async function setupTestContext(fetchImpl = async () => new Response(JSON.stringify({ data: [] }))) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chutes-v1-models-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  mockNextResponse();
  globalThis.fetch = vi.fn(fetchImpl);

  const route = await import("@/app/api/v1/models/route.js");
  const models = await import("@/models/index.js");
  const disabledModels = await import("@/lib/disabledModelsDb.js");

  return {
    GET: route.GET,
    ...models,
    ...disabledModels,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function createActiveChutesConnection(ctx, providerSpecificData) {
  return ctx.createProviderConnection({
    provider: "chutes",
    authType: "apikey",
    name: "Chutes Test Connection",
    apiKey: "chutes-key",
    isActive: true,
    providerSpecificData,
  });
}

async function expectModelIds(ctx) {
  const response = await ctx.GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.object).toBe("list");
  expect(Array.isArray(body.data)).toBe(true);
  return body.data.map((model) => model.id);
}

let cleanup = () => {};

afterEach(() => {
  vi.doUnmock("next/server");
  vi.restoreAllMocks();
  vi.resetModules();
  cleanup();
  cleanup = () => {};
  globalThis.fetch = originalFetch;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("/api/v1/models Chutes runtime catalog", () => {
  it("fetches active Chutes catalog dynamically and preserves slash IDs", async () => {
    const ctx = await setupTestContext(async (url, init) => {
      expect(url).toBe(CHUTES_MODELS_URL);
      expect(init).toMatchObject({
        method: "GET",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer chutes-key",
        },
      });
      return new Response(
        JSON.stringify({
          data: [
            { id: "deepseek-ai/DeepSeek-V3.2" },
            { id: "moonshotai/Kimi-K2-Thinking" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    cleanup = ctx.cleanup;
    await createActiveChutesConnection(ctx);

    const modelIds = await expectModelIds(ctx);

    expect(modelIds).toEqual([
      "ch/deepseek-ai/DeepSeek-V3.2",
      "ch/moonshotai/Kimi-K2-Thinking",
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses explicit enabledModels without fetching upstream Chutes catalog", async () => {
    const ctx = await setupTestContext();
    cleanup = ctx.cleanup;
    await createActiveChutesConnection(ctx, {
      enabledModels: ["manual/provider-model", "ch/already-prefixed"],
    });

    const modelIds = await expectModelIds(ctx);

    expect(modelIds).toEqual(["ch/manual/provider-model", "ch/already-prefixed"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps custom and alias-backed Chutes models when upstream fetch fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = await setupTestContext(async () => new Response("upstream unavailable", { status: 503 }));
    cleanup = ctx.cleanup;
    await createActiveChutesConnection(ctx);
    await ctx.addCustomModel({ providerAlias: "ch", id: "manual-fallback" });
    await ctx.setModelAlias("friendly-chutes", "ch/alias-fallback");

    const modelIds = await expectModelIds(ctx);

    expect(modelIds).toEqual(["ch/manual-fallback", "ch/alias-fallback"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Models] Chutes model catalog fetch failed with status 503"
    );
  });

  it("applies disabled-model filtering to dynamic Chutes catalog IDs", async () => {
    const ctx = await setupTestContext(async () => new Response(
      JSON.stringify({ data: [{ id: "org/live-model" }, { id: "org/hidden-model" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    cleanup = ctx.cleanup;
    await createActiveChutesConnection(ctx);
    await ctx.disableModels("ch", ["org/hidden-model"]);

    const modelIds = await expectModelIds(ctx);

    expect(modelIds).toEqual(["ch/org/live-model"]);
  });
});
