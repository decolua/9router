// Contract tests for /api/usage/connections — the account dropdown source
// behind Usage → Details. The repo layer is mocked so the route never touches
// SQLite (and never pulls in the executors barrel, which needs node-machine-id).
import { describe, it, expect, vi, beforeEach } from "vitest";

// `next` is not installed under tests/node_modules, so stub NextResponse the
// same way the other route tests do.
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

vi.mock("../../src/lib/db/index.js", () => ({
  getProviderConnections: vi.fn(),
}));

import { getProviderConnections } from "../../src/lib/db/index.js";
import { GET } from "../../src/app/api/usage/connections/route.js";

// Realistic repo rows: they carry live credentials, which is exactly why the
// route must project instead of spreading them.
const repoRows = [
  {
    id: "conn-od-1",
    provider: "opendesign-go",
    name: "nesteacold@gmail.com",
    email: "nesteacold@gmail.com",
    isActive: true,
    accessToken: "AT-SECRET-1",
    refreshToken: "RT-SECRET-1",
    apiKey: "SK-SECRET-1",
    data: { apiKey: "SK-SECRET-1" },
  },
  {
    id: "conn-claude-1",
    provider: "claude",
    name: "primary@example.com",
    email: "primary@example.com",
    isActive: true,
    accessToken: "AT-SECRET-2",
    refreshToken: "RT-SECRET-2",
  },
  {
    id: "conn-od-2",
    provider: "opendesign-go",
    name: "second@gmail.com",
    email: "second@gmail.com",
    isActive: true,
    accessToken: "AT-SECRET-3",
  },
];

function makeReq(query = "") {
  return new Request(`http://localhost/api/usage/connections${query ? `?${query}` : ""}`);
}

function mockRepo(fn) {
  getProviderConnections.mockImplementation(async (filter = {}) => {
    let rows = repoRows;
    if (filter.provider) rows = rows.filter((r) => r.provider === filter.provider);
    if (filter.isActive !== undefined) rows = rows.filter((r) => !!r.isActive === !!filter.isActive);
    return fn ? fn(rows) : rows;
  });
}

describe("GET /api/usage/connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the {connections:[{id,provider,name}]} shape", async () => {
    mockRepo();

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Object.keys(body)).toEqual(["connections"]);
    expect(Array.isArray(body.connections)).toBe(true);
    expect(body.connections).toHaveLength(3);
    expect(body.connections[0]).toEqual({
      id: "conn-od-1",
      provider: "opendesign-go",
      name: "nesteacold@gmail.com",
    });
    // Only the three safe keys are present — nothing else sneaks in.
    for (const item of body.connections) {
      expect(Object.keys(item).sort()).toEqual(["id", "name", "provider"]);
    }
  });

  it("never exposes credential fields on any item", async () => {
    mockRepo();

    const body = await (await GET(makeReq())).json();
    for (const item of body.connections) {
      expect(item.data).toBeUndefined();
      expect(item.apiKey).toBeUndefined();
      expect(item.accessToken).toBeUndefined();
      expect(item.refreshToken).toBeUndefined();
      expect(item.idToken).toBeUndefined();
      expect(item.email).toBeUndefined();
      expect(item.providerSpecificData).toBeUndefined();
    }
    // And no secret leaks through the serialized payload either.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("SECRET");
  });

  it("filters by ?provider= and forwards the provider to the repo", async () => {
    mockRepo();

    const body = await (await GET(makeReq("provider=opendesign-go"))).json();
    expect(body.connections.map((c) => c.id)).toEqual(["conn-od-1", "conn-od-2"]);
    expect(getProviderConnections).toHaveBeenCalledWith({ isActive: true, provider: "opendesign-go" });
  });

  it("returns an empty list for a provider with no connections", async () => {
    mockRepo();

    const body = await (await GET(makeReq("provider=unknown-provider"))).json();
    expect(body.connections).toEqual([]);
  });

  it("asks the repo for active rows only", async () => {
    // Repo returns an inactive row when not scoped; the route must scope it.
    let seenFilter;
    getProviderConnections.mockImplementation(async (filter = {}) => {
      seenFilter = filter;
      return repoRows.filter((r) => (filter.isActive ? r.isActive : true));
    });

    await GET(makeReq());

    expect(seenFilter).toEqual({ isActive: true });
  });

  it("drops inactive rows even if the repo returns them anyway", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "active-1", provider: "claude", name: "on@example.com", isActive: true },
      { id: "off-1", provider: "claude", name: "off@example.com", isActive: false },
    ]);

    const body = await (await GET(makeReq())).json();
    expect(body.connections.map((c) => c.id)).toEqual(["active-1"]);
  });

  it("falls back to email when an older row left name empty", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "legacy-1", provider: "claude", name: null, email: "legacy@example.com", isActive: true },
    ]);

    const body = await (await GET(makeReq())).json();
    expect(body.connections[0].name).toBe("legacy@example.com");
  });

  it("repo failure → 500 with {error}, not a thrown exception", async () => {
    getProviderConnections.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to fetch connections");

    spy.mockRestore();
  });
});
