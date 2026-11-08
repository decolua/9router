import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /v1/models/query must be served by the new static `query` segment, not by
// the [...model] catch-all (which exports no POST).
const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { POST } = await import("../../src/app/api/v1/models/query/route.js");
const catchAll = await import("../../src/app/api/v1/models/[...model]/route.js");

function post(body) {
  return {
    json: async () => (body === undefined ? JSON.parse("not-json") : body),
  };
}

function orderViolations(list) {
  const bad = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    const ownerCmp = prev.owned_by < cur.owned_by ? -1 : prev.owned_by > cur.owned_by ? 1 : 0;
    if (ownerCmp > 0 || (ownerCmp === 0 && prev.id >= cur.id)) {
      bad.push(`${prev.id} -> ${cur.id}`);
    }
  }
  return bad;
}

// Controlled two-model catalog for predicate tests.
function useDeepseekCatalog() {
  db.getProviderConnections.mockResolvedValue([
    {
      id: "c1",
      provider: "deepseek",
      isActive: true,
      providerSpecificData: { enabledModels: ["deepseek-v4.1-flash", "deepseek-chat"] },
    },
  ]);
}

describe("POST /v1/models/query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getProviderConnections.mockResolvedValue([]);
  });

  it("is handled by the new static route, not the catch-all", async () => {
    expect(typeof POST).toBe("function");
    expect(catchAll.POST).toBeUndefined();
    expect(typeof catchAll.GET).toBe("function");
    expect(typeof catchAll.OPTIONS).toBe("function");
  });

  it("returns the documented envelope", async () => {
    useDeepseekCatalog();
    const res = await POST(post({ capabilities: ["tools"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["data", "object"]);
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
    for (const rec of body.data) {
      expect(rec.object).toBe("model");
      expect(typeof rec.id).toBe("string");
      expect(typeof rec.owned_by).toBe("string");
    }
  });

  it("narrows with the same predicates as GET", async () => {
    useDeepseekCatalog();

    const maxOutput = await POST(post({ max_output: 100000 }));
    expect((await maxOutput.json()).data.map((m) => m.id.split("/").pop())).toEqual(["deepseek-v4.1-flash"]);

    const minContext = await POST(post({ min_context: 500000 }));
    expect((await minContext.json()).data.map((m) => m.id.split("/").pop())).toEqual(["deepseek-v4.1-flash"]);

    const caps = await POST(post({ capabilities: ["vision", "tools"] }));
    expect((await caps.json()).data.map((m) => m.id.split("/").pop())).toEqual(["deepseek-v4.1-flash"]);

    const notIn = await POST(post({ capabilities: ["telepathy"] }));
    expect(notIn.status).toBe(400);
    expect((await notIn.json()).error.allowed).toContain("vision");

    const badMin = await POST(post({ min_context: "abc" }));
    expect(badMin.status).toBe(400);

    const badMax = await POST(post({ max_output: 1.5 }));
    expect(badMax.status).toBe(400);
  });

  it("supports owned_by, q and exclude", async () => {
    useDeepseekCatalog();

    const rows = (await (await POST(post({}))).json()).data;
    expect(rows.length).toBe(2);
    const owner = rows[0].owned_by;

    const byOwner = await (await POST(post({ owned_by: owner }))).json();
    expect(byOwner.data.every((m) => m.owned_by === owner)).toBe(true);

    const excluded = await (await POST(post({ exclude: [rows[0].id] }))).json();
    expect(excluded.data.find((m) => m.id === rows[0].id)).toBeUndefined();

    const query = await (await POST(post({ q: "CHAT" }))).json();
    expect(query.data.map((m) => m.id.split("/").pop())).toEqual(["deepseek-chat"]);
  });

  it("orders deterministically by owned_by then id", async () => {
    // Static catalog: many providers, so both sort keys are exercised.
    const body = await (await POST(post({ limit: 50 }))).json();
    expect(body.data.length).toBeGreaterThan(5);
    expect(orderViolations(body.data)).toEqual([]);

    // Repeated calls must produce identical bytes.
    const again = await (await POST(post({ limit: 50 }))).json();
    expect(JSON.stringify(again)).toBe(JSON.stringify(body));
  });

  it("defaults to 20 results and hard-caps at 100", async () => {
    const defaulted = await (await POST(post({}))).json();
    expect(defaulted.data).toHaveLength(20);

    const capped = await (await POST(post({ limit: 9999 }))).json();
    expect(capped.data).toHaveLength(100);

    const explicit = await (await POST(post({ limit: 3 }))).json();
    expect(explicit.data).toHaveLength(3);
  });

  it("rejects an invalid limit", async () => {
    expect((await POST(post({ limit: 0 }))).status).toBe(400);
    expect((await POST(post({ limit: -1 }))).status).toBe(400);
    expect((await POST(post({ limit: "abc" }))).status).toBe(400);
  });

  it("rejects a malformed body", async () => {
    expect((await POST(post(undefined))).status).toBe(400);
    expect((await POST(post([1, 2, 3]))).status).toBe(400);
  });
});
