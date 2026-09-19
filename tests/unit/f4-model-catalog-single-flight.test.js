// T1.5 M5 — POST /api/providers/[id]/model-catalog has no debounce and no
// single-flight: two clicks run the same 3×15s fetch twice, and the
// read-compute-write of `modelCatalog` lets the last writer reset the
// "missing from N consecutive syncs" counters another sync just advanced.
//
// Each test uses its own connection id: the cooldown ledger is keyed per
// connection (as is the in-flight map), so ids never leak state between cases.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnections: db.getProviderConnections,
  getProviderConnectionById: db.getProviderConnectionById,
  updateProviderConnection: db.updateProviderConnection,
}));

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
const modelCatalogRoute = await import("@/app/api/providers/[id]/model-catalog/route.js");

const { syncConnectionCatalog, syncDueConnectionCatalogs, MANUAL_SYNC_COOLDOWN_MS } = catalog;
const { POST } = modelCatalogRoute;

const OPENAI_LIST = (ids) => ({ data: ids.map((id) => (typeof id === "string" ? { id } : id)) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "m2" is one valid sync away from being declared gone: exactly the counter a
// racing second write can silently rewind.
const previousCatalog = () => ({
  models: [
    { id: "m1", name: "m1", tier: "unknown", availability: "available", missingSyncs: 0 },
    { id: "m2", name: "m2", tier: "unknown", availability: "temporarily-absent", missingSyncs: 1 },
  ],
  lastSuccessAt: new Date().toISOString(),
  lastError: null,
});

const rows = new Map();

function seed(id, { provider = "bai", modelCatalog = previousCatalog() } = {}) {
  rows.set(id, { id, provider, apiKey: "k", modelCatalog });
  return id;
}

// A read returns a detached snapshot, the way the routes do: two reads taken
// before either write must see the same "previous" catalog.
function connection(id) {
  const row = rows.get(id);
  return row ? { ...row, modelCatalog: structuredClone(row.modelCatalog) } : null;
}

async function manualPost(id) {
  const response = await POST(
    new Request(`https://9router.local/api/providers/${id}/model-catalog`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

let fetchCount;
function installFetch(handler) {
  fetchCount = 0;
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCount += 1;
    const outcome = handler(fetchCount, url, init);
    if (outcome instanceof Error) {
      await sleep(1); // keep the attempt order observable
      throw outcome;
    }
    await sleep(outcome.delay);
    return new Response(JSON.stringify(outcome.list), { status: 200 });
  });
  return () => fetchCount;
}

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  db.getProviderConnectionById.mockImplementation(async (id) => connection(id));
  db.getProviderConnections.mockResolvedValue([]);
  db.updateProviderConnection.mockImplementation(async (id, data) => {
    rows.get(id).modelCatalog = structuredClone(data.modelCatalog);
    return null;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("manual model-catalog sync is single-flight per connection (M5)", () => {
  it("collapses two concurrent POSTs into one upstream fetch and one catalog write", async () => {
    // 1st click: m2 gone → missingSyncs 2 (unavailable). 2nd click: m2 back,
    // slower → in the unfixed code it lands last and rewinds the counter.
    installFetch((count) => (count === 1
      ? { list: OPENAI_LIST(["m1"]), delay: 2 }
      : { list: OPENAI_LIST(["m1", "m2"]), delay: 30 }));
    const id = seed("conn-race");

    const [first, second] = await Promise.all([manualPost(id), manualPost(id)]);

    expect(fetchCount, "one connection must never run two /models fetches at once").toBe(1);
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);

    const m2 = rows.get(id).modelCatalog.models.find((m) => m.id === "m2");
    expect(m2.missingSyncs, "a racing second write must not rewind the counter").toBe(2);
    expect(m2.availability).toBe("unavailable");

    // Panel contract: a double click gets two ordinary successes, never a
    // skipped/error shape the dashboard would misread.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    for (const { body } of [first, second]) {
      expect(body.error).toBeUndefined();
      expect(body.skipped).toBeUndefined();
      expect(body.updated).toBe(true);
      expect(body.counts.available).toBe(1);
    }
  });

  it("joins the in-flight sync instead of starting a second one (same result object)", async () => {
    installFetch(() => ({ list: OPENAI_LIST(["m1"]), delay: 10 }));
    const id = seed("conn-join");
    const conn = connection(id);

    const automatic = syncConnectionCatalog(conn, { automatic: true });
    const manual = syncConnectionCatalog(conn, { cooldownMs: MANUAL_SYNC_COOLDOWN_MS });
    const [autoResult, manualResult] = await Promise.all([automatic, manual]);

    expect(manualResult).toBe(autoResult);
    expect(fetchCount).toBe(1);
  });

  it("does not dedupe different connections", async () => {
    installFetch(() => ({ list: OPENAI_LIST(["m1"]), delay: 5 }));
    const a = seed("conn-multi-a");
    const b = seed("conn-multi-b", { provider: "openrouter" });

    const results = await Promise.all([manualPost(a), manualPost(b)]);
    expect(fetchCount).toBe(2);
    for (const { status } of results) expect(status).toBe(200);
  });

  it("answers a second click inside the cooldown from the finished sync", async () => {
    installFetch(() => ({ list: OPENAI_LIST(["m1", "m2"]), delay: 1 }));
    const id = seed("conn-cooldown");

    const first = await manualPost(id);
    const second = await manualPost(id);

    expect(first.body.updated).toBe(true);
    expect(fetchCount, "a repeat click inside the cooldown must not refetch upstream").toBe(1);
    expect(db.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.updated).toBe(true);
    expect(second.body.counts.available).toBe(2);
  });

  it("does not re-burn upstream quota inside the cooldown after a failure", async () => {
    installFetch(() => new Error("upstream down"));
    const id = seed("conn-failure");

    const first = await manualPost(id);
    const fetchesAfterFirst = fetchCount;
    const second = await manualPost(id);

    expect(first.status).toBe(502);
    expect(fetchesAfterFirst).toBe(3); // 3 attempts with backoff, once
    expect(second.status).toBe(502);
    expect(second.body.deduped).toBe(true);
    expect(second.body.error).toBe(first.body.error);
    expect(fetchCount, "the cooldown must hold for failures too").toBe(fetchesAfterFirst);
  });

  it("lets a new sync through once the cooldown has elapsed", async () => {
    installFetch(() => ({ list: OPENAI_LIST(["m1"]), delay: 1 }));
    const id = seed("conn-expiry");
    const conn = connection(id);

    await syncConnectionCatalog(conn, { cooldownMs: 40 });
    await syncConnectionCatalog(conn, { cooldownMs: 40 });
    expect(fetchCount).toBe(1);

    await sleep(60);
    await syncConnectionCatalog(conn, { cooldownMs: 40 });
    expect(fetchCount, "cooldown is a short guard, not a permanent block").toBe(2);
  });

  it("keeps the dashboard guard at 30s and never cooldown-gates automatic callers", async () => {
    expect(MANUAL_SYNC_COOLDOWN_MS).toBe(30_000);
    installFetch(() => ({ list: OPENAI_LIST(["m1"]), delay: 1 }));
    const id = seed("conn-automatic");
    const conn = connection(id);

    await syncConnectionCatalog(conn, { automatic: true });
    await syncConnectionCatalog(conn, { automatic: true });
    expect(fetchCount, "the 24h scheduler path must never be cooldown-suppressed").toBe(2);
  });

  it("runs the scheduler batch through the same chokepoint", async () => {
    installFetch(() => ({ list: OPENAI_LIST(["m1"]), delay: 1 }));
    const id = seed("conn-batch");
    db.getProviderConnections.mockResolvedValue([connection(id)]);

    const results = await syncDueConnectionCatalogs({ force: true });
    expect(results).toHaveLength(1);
    expect(results[0].updated).toBe(true);
    expect(fetchCount).toBe(1);
  });
});
