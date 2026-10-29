// R3-01 — PUT /api/keys/[id] must honor `name` (rename) instead of silently
// returning 200 with no change. Empty/blank names get a 400; a body with
// neither `name` nor `isActive` gets a 400 ("nothing to update") instead of
// a misleading no-op 200. Follows the route-handler test pattern of
// tests/unit/auth-status.test.js (vi.mock the db layer, import the route).
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
}));

const { PUT } = await import("../../src/app/api/keys/[id]/route.js");

function req(body) {
  return { json: async () => body };
}

const PARAMS = { params: Promise.resolve({ id: "key-1" }) };

describe("PUT /api/keys/[id] — rename support (R3-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeyById.mockResolvedValue({ id: "key-1", name: "old", isActive: 1, key: "sk-x" });
    mocks.updateApiKey.mockImplementation(async (_id, data) => ({
      id: "key-1",
      key: "sk-x",
      ...data,
    }));
  });

  it("renames a key when a new name is provided", async () => {
    const res = await PUT(req({ name: "renamed" }), PARAMS);

    expect(res.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", { name: "renamed" });
    expect(res.body.key.name).toBe("renamed");
  });

  it("still supports the existing isActive toggle", async () => {
    const res = await PUT(req({ isActive: false }), PARAMS);

    expect(res.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", { isActive: false });
  });

  it("accepts name + isActive together", async () => {
    const res = await PUT(req({ name: "both", isActive: true }), PARAMS);

    expect(res.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", { name: "both", isActive: true });
  });

  it("rejects an empty name with 400 (matches POST /api/keys name requirement)", async () => {
    const res = await PUT(req({ name: "" }), PARAMS);

    expect(res.status).toBe(400);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("rejects a blank (whitespace) name with 400", async () => {
    const res = await PUT(req({ name: "   " }), PARAMS);

    expect(res.status).toBe(400);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("rejects a non-string name with 400", async () => {
    const res = await PUT(req({ name: 42 }), PARAMS);

    expect(res.status).toBe(400);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("returns 400 instead of a silent no-op 200 when nothing is updatable", async () => {
    const res = await PUT(req({}), PARAMS);

    expect(res.status).toBe(400);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("returns 404 when the key does not exist", async () => {
    mocks.getApiKeyById.mockResolvedValue(null);
    const res = await PUT(req({ name: "x" }), { params: Promise.resolve({ id: "missing" }) });

    expect(res.status).toBe(404);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });
});
