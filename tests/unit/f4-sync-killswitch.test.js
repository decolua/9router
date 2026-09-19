// T1.5 M4 — `CONNECTION_MODEL_SYNC=off` must cover EVERY automatic catalog
// sync (daily scheduler, first-sync on connection creation, post-migration
// sync) while the manual dashboard sync (Models button) keeps working.
// Contract: docs/MODEL_SYNC_CATALOG.md:15-17.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The migration route writes a pre-migration backup under DATA_DIR at call
// time; keep it out of the developer's real ~/.9router.
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f4-killswitch-"));
process.env.DATA_DIR = tempDataDir;

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  createProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(),
  getProviderNodes: vi.fn(),
  getProxyPoolById: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnections: db.getProviderConnections,
  getProviderConnectionById: db.getProviderConnectionById,
  updateProviderConnection: db.updateProviderConnection,
  createProviderConnection: db.createProviderConnection,
  getProviderNodeById: db.getProviderNodeById,
  getProviderNodes: db.getProviderNodes,
  getProxyPoolById: db.getProxyPoolById,
  getCombos: db.getCombos,
  getCustomModels: db.getCustomModels,
  getModelAliases: db.getModelAliases,
}));

// Hermetic: no DNS, no real sockets. fetchPublic forwards to the per-test stub.
vi.mock("@/shared/utils/ssrfGuard.js", () => ({
  assertPublicUrl: vi.fn(),
  fetchPublic: (...args) => globalThis.fetch(...args),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const catalog = await import("@/lib/modelSync/connectionCatalog.js");
const scheduler = await import("@/lib/modelSync/scheduler.js");
const providersRoute = await import("@/app/api/providers/route.js");
const migrationRoute = await import("@/app/api/providers/migration-suggestions/route.js");
const modelCatalogRoute = await import("@/app/api/providers/[id]/model-catalog/route.js");

const OPENAI_LIST = (ids) => ({ data: ids.map((id) => (typeof id === "string" ? { id } : id)) });

// Connections chosen so the sync IS scheduler-eligible: `bai` resolves through
// its registry modelsFetcher (type "openai"), `openrouter` through its own
// (type "openrouter-free"). Both are in SYNCABLE_MODELS_FETCHER_TYPES.
const baiConn = (overrides = {}) => ({
  id: "conn-bai",
  provider: "bai",
  name: "Bai",
  apiKey: "secret-key",
  providerSpecificData: {},
  ...overrides,
});

const nativeConn = (overrides = {}) => ({
  id: "conn-native",
  provider: "openrouter",
  name: "OpenRouter (native)",
  apiKey: "secret-key",
  providerSpecificData: {},
  ...overrides,
});

let fetchCalls;
function installFetch() {
  fetchCalls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url: String(url), headers: init?.headers });
    return new Response(JSON.stringify(OPENAI_LIST(["m1", "m2"])), { status: 200 });
  });
}

// The creation/migration syncs are fire-and-forget: yield until their promise
// chain (resolve → fetch → json → update) has had its turn.
async function settle(times = 12) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 1));
}

const request = (url, body) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function createProvider() {
  return providersRoute.POST(request("https://9router.local/api/providers", {
    provider: "bai",
    name: "Bai",
    apiKey: "secret-key",
  }));
}

async function migrateConnection() {
  return migrationRoute.POST(request("https://9router.local/api/providers/migration-suggestions", {
    connectionId: "conn-custom",
    nativeProvider: "openrouter",
  }));
}

function manualSync(id = "conn-bai") {
  return modelCatalogRoute.POST(
    new Request(`https://9router.local/api/providers/${id}/model-catalog`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installFetch();
  db.getProviderConnections.mockResolvedValue([baiConn()]);
  db.getProviderConnectionById.mockImplementation(async (id) => {
    if (id === "conn-native") return nativeConn();
    if (id === "conn-custom") {
      return {
        id: "conn-custom",
        provider: "openai-compatible:node-1",
        name: "Custom OR",
        apiKey: "secret-key",
        priority: 1,
        providerSpecificData: { baseUrl: "https://openrouter.ai/api/v1", prefix: "or" },
      };
    }
    // Every manual-sync case uses its own id: the manual cooldown is keyed per
    // connection, so cases must not inherit each other's guard.
    if (String(id).startsWith("conn-bai")) return baiConn({ id });
    return null;
  });
  db.createProviderConnection.mockImplementation(async (data) => ({
    ...(data.provider === "openrouter" ? nativeConn() : baiConn()),
    ...data,
  }));
  db.updateProviderConnection.mockResolvedValue(null);
  db.getProviderNodeById.mockResolvedValue(null);
  db.getProviderNodes.mockResolvedValue([]);
  db.getProxyPoolById.mockResolvedValue(null);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getModelAliases.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CONNECTION_MODEL_SYNC=off gates every automatic sync (M4)", () => {
  it("does not sync when a connection is created", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");
    const response = await createProvider();
    expect(response.status).toBe(201);
    await settle();
    expect(fetchCalls, "creation must not fetch the model list while sync is off").toEqual([]);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not sync after a custom→native migration", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");
    const response = await migrateConnection();
    expect(response.status).toBe(201);
    await settle();
    expect(fetchCalls, "migration must not fetch the model list while sync is off").toEqual([]);
  });

  it("does not sync from the recurring batch (syncDueConnectionCatalogs)", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");
    const results = await catalog.syncDueConnectionCatalogs({ force: true });
    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(true);
    expect(fetchCalls).toEqual([]);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not start the scheduler timer", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");
    vi.useFakeTimers();
    try {
      scheduler.startConnectionCatalogSync();
      await vi.advanceTimersByTimeAsync(91_000);
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
    expect(fetchCalls).toEqual([]);
    expect(db.getProviderConnections).not.toHaveBeenCalled();
  });

  it("still runs the manual dashboard sync (Models button)", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");
    const response = await manualSync("conn-bai-off-manual");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updated).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/models");
  });
});

describe("kill switch left on (default)", () => {
  it("syncs on connection creation", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "on");
    const response = await createProvider();
    expect(response.status).toBe(201);
    await settle();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/models");
    // Credential still travels as a header only (never logged).
    expect(fetchCalls[0].headers?.Authorization).toBe("Bearer secret-key");
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("syncs on migration and on manual request", async () => {
    const migration = await migrateConnection();
    expect(migration.status).toBe(201);
    await settle();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("openrouter.ai");

    const manual = await manualSync("conn-bai-on-manual");
    expect(manual.status).toBe(200);
    await settle();
    expect(fetchCalls).toHaveLength(2);
  });

  it("treats an unset flag as enabled", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "");
    expect(catalog.isAutomaticModelSyncEnabled()).toBe(true);
    vi.stubEnv("CONNECTION_MODEL_SYNC", "OFF");
    expect(catalog.isAutomaticModelSyncEnabled()).toBe(false);
    vi.stubEnv("CONNECTION_MODEL_SYNC", " off ");
    expect(catalog.isAutomaticModelSyncEnabled()).toBe(false);
  });
});

describe("chokepoint API of syncConnectionCatalog", () => {
  it("obeys the flag only for automatic calls", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");

    const automatic = await catalog.syncConnectionCatalog(baiConn(), { automatic: true });
    expect(automatic.updated).toBe(false);
    expect(automatic.skipped).toBe(true);
    expect(automatic.disabled).toBe(true);
    expect(automatic.reason).toContain("CONNECTION_MODEL_SYNC=off");
    expect(fetchCalls).toEqual([]);

    const automaticById = await catalog.syncConnectionCatalog("conn-bai", { automatic: true });
    expect(automaticById.connectionId).toBe("conn-bai");
    expect(automaticById.disabled).toBe(true);

    const manual = await catalog.syncConnectionCatalog(baiConn());
    expect(manual.updated).toBe(true);
    expect(fetchCalls).toHaveLength(1);

    const explicitManual = await catalog.syncConnectionCatalog(baiConn(), { automatic: false });
    expect(explicitManual.updated).toBe(true);
    expect(fetchCalls).toHaveLength(2);
  });

  it("never touches the database or the network for a suppressed automatic sync", async () => {
    vi.stubEnv("CONNECTION_MODEL_SYNC", "off");
    await catalog.syncConnectionCatalog("conn-bai", { automatic: true });
    expect(db.getProviderConnectionById).not.toHaveBeenCalled();
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });
});
