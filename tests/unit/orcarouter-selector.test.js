import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

/**
 * Exercises the real `/api/providers/[id]/models` handler — the exact endpoint the
 * OrcaRouter model dropdown calls — so the assertions prove what the selector is
 * allowed to display rather than what a mock returns. The route is the only place
 * that holds the API key; the browser never sees it.
 */
const originalDataDir = process.env.DATA_DIR;
let tempDir;
let route;
let repos;

/** Catalog shaped like the live relay response (see live probe: {data,object,success}). */
const LIVE_CATALOG = {
  object: "list",
  success: true,
  data: [
    {
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      context_length: 400000,
      supported_endpoint_types: ["openai", "openai-response"],
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      reasoning: true,
      reasoning_efforts: ["low", "medium", "high", "xhigh"],
    },
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      context_length: 1048576,
      supported_endpoint_types: ["openai"],
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    },
    {
      id: "black-forest-labs/flux-1-schnell",
      name: "FLUX 1 Schnell",
      supported_endpoint_types: ["image-generation"],
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
    },
    {
      id: "openai/text-embedding-3-large",
      name: "Text Embedding 3 Large",
      supported_endpoint_types: ["embedding"],
      architecture: { input_modalities: ["text"], output_modalities: ["embedding"] },
    },
  ],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** Drive the exported handler exactly as Next.js would. */
async function callModels(connectionId, query = "") {
  const request = new Request(`http://127.0.0.1:20128/api/providers/${connectionId}/models${query}`);
  const res = await route.GET(request, { params: Promise.resolve({ id: connectionId }) });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-orca-selector-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  repos = await import("@/lib/db/repos/connectionsRepo.js");
  route = await import("@/app/api/providers/[id]/models/route.js");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function freshConnection() {
  return repos.createProviderConnection({
    provider: "orcarouter",
    authType: "apikey",
    name: "OrcaRouter selector test",
    apiKey: "sk-orca-fake-selector-key",
    accessToken: "sk-orca-fake-selector-key",
    testStatus: "active",
  });
}

describe("orcarouter selector catalog endpoint", () => {
  it("serves the live chat catalog and keeps vendor namespaces intact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(LIVE_CATALOG)));
    const conn = await freshConnection();

    const { status, body } = await callModels(conn.id, "?capability=chat");

    expect(status).toBe(200);
    expect(body.source).toBe("live");
    expect(body.degraded).toBe(false);
    const ids = body.models.map((m) => m.id);
    expect(ids).toContain("openai/gpt-5.5");
    expect(ids).toContain("deepseek/deepseek-v4-pro");
    // Vendor/model namespace is preserved verbatim — the selector value is the
    // same id a caller passes back on a completion request.
    expect(ids.every((id) => id.includes("/"))).toBe(true);
  });

  it("excludes media-only models from the chat dropdown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(LIVE_CATALOG)));
    const conn = await freshConnection();

    const { body } = await callModels(conn.id, "?capability=chat");
    const ids = body.models.map((m) => m.id);

    // Image-generation and embedding entries declare no chat endpoint type, so
    // they must not leak into a text picker.
    expect(ids).not.toContain("black-forest-labs/flux-1-schnell");
    expect(ids).not.toContain("openai/text-embedding-3-large");
  });

  it("narrows to declared image input when the entry point carries an image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(LIVE_CATALOG)));
    const conn = await freshConnection();

    const text = await callModels(conn.id, "?capability=chat");
    const vision = await callModels(conn.id, "?capability=chat&modality=image");

    expect(vision.body.models.map((m) => m.id)).toEqual(["openai/gpt-5.5"]);
    // The multimodal slice is strictly smaller, and the text-only model is gone.
    expect(vision.body.models.length).toBeLessThan(text.body.models.length);
    expect(vision.body.models.map((m) => m.id)).not.toContain("deepseek/deepseek-v4-pro");
  });

  it("rejects an unknown capability or modality instead of returning an unfiltered list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(LIVE_CATALOG)));
    const conn = await freshConnection();

    const badCap = await callModels(conn.id, "?capability=telepathy");
    expect(badCap.status).toBe(400);
    expect(badCap.body.error).toMatch(/capability/i);

    const badMod = await callModels(conn.id, "?capability=chat&modality=smell");
    expect(badMod.status).toBe(400);
    expect(badMod.body.error).toMatch(/modality/i);
  });

  it("labels a degraded catalog and still returns a verified fallback list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)));
    const conn = await freshConnection();

    const { status, body } = await callModels(conn.id, "?capability=chat");

    expect(status).toBe(200);
    expect(body.source).toBe("fallback");
    expect(body.degraded).toBe(true);
    expect(body.warning).toBeTruthy();
    // A cold start still yields selectable options — never free text.
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.map((m) => m.id)).toContain("orcarouter/auto");
  });

  it("never performs a refresh grant, and never leaks the key sideways", async () => {
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      seen.push({ url: String(url), init });
      return jsonResponse(LIVE_CATALOG);
    }));
    const conn = await freshConnection();

    const { body } = await callModels(conn.id, "?capability=chat");

    // Discovery is a single GET against the inference base only.
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).origin).toBe("https://api.orcarouter.ai");
    expect(new URL(seen[0].url).pathname).toBe("/v1/models");
    expect(seen[0].init.method).toBe("GET");
    expect(seen[0].init.headers.Authorization).toBe("Bearer sk-orca-fake-selector-key");

    // The response payload is metadata only: no credential may ride along to the
    // browser that renders the dropdown.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sk-orca-fake-selector-key");
    expect(serialized).not.toContain("Bearer");
  });

  it("surfaces the reasoning ladder the selector needs for level-aware entries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(LIVE_CATALOG)));
    const conn = await freshConnection();

    const { body } = await callModels(conn.id, "?capability=chat");
    const gpt = body.models.find((m) => m.id === "openai/gpt-5.5");

    expect(gpt.reasoning).toBe(true);
    expect(gpt.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(gpt.inputModalities).toContain("image");
    expect(gpt.contextLength).toBe(400000);
  });

  it("declares passthrough models, which is why the selector must resolve the live catalog first", async () => {
    // The shared selector has a separate `passthroughModels` branch that only
    // knows locally-registered aliases. OrcaRouter is published with that flag,
    // so the component must take its capability-filtered catalog branch *before*
    // the passthrough branch, or the dropdown silently shows the static seed.
    // If this flag is ever removed, revisit that ordering in ModelSelectModal.
    const { OAUTH_PROVIDERS, AI_PROVIDERS } = await import("@/shared/constants/providers.js");
    const info = OAUTH_PROVIDERS.orcarouter || AI_PROVIDERS.orcarouter;
    expect(info.passthroughModels).toBe(true);
    expect(info.name).toBe("OrcaRouter");
  });

  it("never serves the static alias list as if it were the live catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(LIVE_CATALOG)));
    const conn = await freshConnection();

    const { body } = await callModels(conn.id, "?capability=chat");
    const ids = body.models.map((m) => m.id);
    const names = body.models.map((m) => m.name);

    // Live discovery is authoritative: the seed's display names must not appear
    // when the relay answered, or a verified fallback would masquerade as live.
    expect(names).toContain("GPT-5.5");
    expect(ids).not.toContain("orcarouter/auto");
    expect(body.source).toBe("live");
    expect(body.degraded).toBe(false);
  });
});
