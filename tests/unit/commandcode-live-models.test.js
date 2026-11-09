// Route-level acceptance for CommandCode live-model discovery:
//   GET /api/providers/[connectionId]/models  →  vendor catalog  →  UI rows
// The catalog URL is public, but the route still requires a seeded connection.
// Self-isolating: DATA_DIR points at a temp dir so seeding never touches ~/.9router.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

const CATALOG_URL = "https://api.commandcode.ai/provider/v1/models?view=client";

const stub = vi.hoisted(() => ({ mode: "ok", calls: [] }));

stub.catalog = {
  catalogVersion: "catalog-abc123",
  object: "list",
  refreshAfterSeconds: 900,
  data: [
    {
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      context_length: 1000000,
      inputModalities: ["text", "image"],
      reasoningEfforts: ["low", "medium", "high"],
      display: { label: "Claude Sonnet 5.5", description: "best combo of speed & intelligence" },
    },
    {
      id: "deepseek/deepseek-v4.1-flash-fast",
      name: "DeepSeek V4.1 Flash Fast",
      context_length: 1000000,
      maxOutputTokens: 262144,
      inputModalities: ["text"],
      reasoningEfforts: null,
      display: { label: "DeepSeek V4.1 Flash Fast (latest)", description: "High throughput V4.1 Flash" },
    },
    {
      id: "stealth/glyph-cluster:free",
      hidden: true,
      context_length: 256000,
      inputModalities: ["text"],
      reasoningEfforts: ["high"],
      display: { label: "Glyph Cluster" },
    },
  ],
};

beforeEach(() => {
  stub.mode = "ok";
  stub.calls.length = 0;
  // Install AFTER the route import: open-sse/utils/proxyFetch.js assigns
  // globalThis.fetch at import time, so a stub installed before would be replaced.
  vi.stubGlobal("fetch", async (url, options) => {
    const href = String(url);
    stub.calls.push({ url: href, headers: options?.headers || {} });
    if (href !== CATALOG_URL) return new Response("unexpected url", { status: 404 });
    if (stub.mode === "error") return new Response("boom", { status: 500 });
    return Response.json(stub.catalog);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Imports must be dynamic so DATA_DIR is set before the DB layer loads.
const originalDataDir = process.env.DATA_DIR;
let GET;
let createProviderConnection;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "9router-commandcode-live-"));
  vi.resetModules();
  ({ GET } = await import("@/app/api/providers/[id]/models/route.js"));
  ({ createProviderConnection } = await import("@/models/index.js"));
});

afterAll(() => {
  // Windows keeps the sqlite handle open, so the temp dir may refuse removal.
  try {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  } catch {
    // best effort — the OS temp dir is cleaned up anyway
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function seedCommandCode(n) {
  return createProviderConnection({
    provider: "commandcode",
    authType: "apikey",
    name: `commandcode-live-${n}-${Date.now()}`,
    apiKey: `user_live_${n}_${Date.now()}`,
    testStatus: "active",
  });
}

async function getModels(connectionId) {
  const req = new Request(`http://localhost/api/providers/${connectionId}/models`);
  return GET(req, { params: Promise.resolve({ id: connectionId }) });
}

describe("CommandCode catalog — live models reach the dashboard", () => {
  it("returns the vendor catalog with display copy and capability flags", async () => {
    const conn = await seedCommandCode("m1");
    const res = await getModels(conn.id);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.models.map((m) => m.id).sort()).toEqual([
      "claude-sonnet-5-5",
      "deepseek/deepseek-v4.1-flash-fast",
    ]);

    const sonnet = data.models.find((m) => m.id === "claude-sonnet-5-5");
    expect(sonnet.name).toBe("Claude Sonnet 5.5");
    expect(sonnet.description).toBe("best combo of speed & intelligence");
    expect(sonnet.contextLength).toBe(1000000);
    expect(sonnet.isVL).toBe(true);
    expect(sonnet.isReasoning).toBe(true);

    const flash = data.models.find((m) => m.id === "deepseek/deepseek-v4.1-flash-fast");
    expect(flash.name).toBe("DeepSeek V4.1 Flash Fast (latest)");
    expect(flash.maxOutputTokens).toBe(262144);
    expect(flash.isVL).toBe(false);
    expect(flash.isReasoning).toBe(false);
  });

  it("drops hidden aliases the vendor CLI keeps out of its picker", async () => {
    const conn = await seedCommandCode("m2");
    const data = await (await getModels(conn.id)).json();
    expect(data.models.some((m) => m.id === "stealth/glyph-cluster:free")).toBe(false);
  });

  it("identifies as the CommandCode CLI and never leaks the connection key", async () => {
    const conn = await seedCommandCode("m3");
    const res = await getModels(conn.id);
    const data = await res.json();

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe(CATALOG_URL);
    expect(stub.calls[0].headers["x-command-code-version"]).toBeTruthy();
    expect(stub.calls[0].headers["x-cli-surface"]).toBe("cli");

    expect(JSON.stringify(data)).not.toContain(conn.apiKey);
    expect(JSON.stringify(data)).not.toContain("user_live");
  });
});

describe("CommandCode catalog — failure handling", () => {
  it("surfaces the upstream status instead of crashing", async () => {
    stub.mode = "error";
    const conn = await seedCommandCode("e1");
    const res = await getModels(conn.id);
    // The resolver falls back to the static catalog rather than failing the request.
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warning).toMatch(/no live models/i);
    expect(data.models.length).toBeGreaterThan(0);
  });

  it("404s for an unknown connection", async () => {
    const res = await getModels("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/models — the gateway advertises the live catalog", () => {
  it("replaces the static registry list for the cmc alias", async () => {
    const { buildModelsList } = await import("@/app/api/v1/models/route.js");
    const ids = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(ids).toContain("cmc/claude-sonnet-5-5");
    expect(ids).toContain("cmc/deepseek/deepseek-v4.1-flash-fast");
    expect(ids).not.toContain("cmc/stealth/glyph-cluster:free");
  });
});
