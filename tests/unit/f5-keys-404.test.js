// T1.5 B3 — PUT /api/keys/[id]: updateApiKey returns null when the row
// vanished between the existence check and the write (race with DELETE), and
// the route answered 200 { key: null } — callers read `key.name` and crash.
// It must answer 404, like GET/DELETE already do for a missing row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const db = vi.hoisted(() => ({
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);

const { PUT } = await import("@/app/api/keys/[id]/route.js");

beforeEach(() => {
  // The key exists when the route checks, and is gone by update time (DELETE raced in).
  db.getApiKeyById.mockResolvedValue({ id: "k1", name: "ci", isActive: true });
  db.updateApiKey.mockResolvedValue(null);
});

afterEach(() => vi.clearAllMocks());

async function putKey(id = "k1", body = { isActive: false }) {
  const res = await PUT(
    new Request(`http://localhost:20128/api/keys/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

describe("PUT /api/keys/[id] — lost update race must surface as 404 (B3)", () => {
  it("returns 404 when updateApiKey finds the row gone (null)", async () => {
    const result = await putKey();
    expect(result.status).toBe(404);
    expect(result.body.key).toBeUndefined();
    expect(result.body.error).toBeTruthy();
  });

  it("still returns 200 with the updated key on success", async () => {
    db.updateApiKey.mockResolvedValue({ id: "k1", name: "ci", isActive: false });
    const result = await putKey();
    expect(result.status).toBe(200);
    expect(result.body.key).toEqual({ id: "k1", name: "ci", isActive: false });
  });

  it("still returns 404 when the pre-check misses the key", async () => {
    db.getApiKeyById.mockResolvedValue(null);
    const result = await putKey("gone");
    expect(result.status).toBe(404);
    expect(db.updateApiKey).not.toHaveBeenCalled();
  });
});
