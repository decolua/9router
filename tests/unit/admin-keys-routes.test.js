import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 })),
  requireAdminApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  renewApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/auth/adminApiKey", () => ({
  requireAdminApiKey: mocks.requireAdminApiKey,
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: mocks.getApiKeys,
  createApiKey: mocks.createApiKey,
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
  deleteApiKey: mocks.deleteApiKey,
  renewApiKey: mocks.renewApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const adminListRoute = await import("../../src/app/api/admin/keys/route.js");
const adminItemRoute = await import("../../src/app/api/admin/keys/[id]/route.js");
const adminRenewRoute = await import("../../src/app/api/admin/keys/[id]/renew/route.js");

function request(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

describe("admin key routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiKey.mockResolvedValue(true);
    mocks.getConsistentMachineId.mockResolvedValue("machine-1");
  });

  it("rejects missing or wrong admin key", async () => {
    mocks.requireAdminApiKey.mockResolvedValue(false);

    const response = await adminListRoute.GET(new Request("http://localhost/api/admin/keys"));

    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "Unauthorized" });
  });

  it("fails closed when admin auth check rejects", async () => {
    mocks.requireAdminApiKey.mockRejectedValue(new Error("auth backend down"));

    const listResponse = await adminListRoute.GET(new Request("http://localhost/api/admin/keys"));
    const itemResponse = await adminItemRoute.GET(new Request("http://localhost/api/admin/keys/key-1"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const renewResponse = await adminRenewRoute.POST(
      request("http://localhost/api/admin/keys/key-1/renew", "POST", { planMonths: 12 }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(listResponse.status).toBe(401);
    expect(await json(listResponse)).toEqual({ error: "Unauthorized" });
    expect(itemResponse.status).toBe(401);
    expect(await json(itemResponse)).toEqual({ error: "Unauthorized" });
    expect(renewResponse.status).toBe(401);
    expect(await json(renewResponse)).toEqual({ error: "Unauthorized" });
  });

  it("lists keys", async () => {
    mocks.getApiKeys.mockResolvedValue([{ id: "key-1", name: "User 1" }]);

    const response = await adminListRoute.GET(new Request("http://localhost/api/admin/keys"));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ keys: [{ id: "key-1", name: "User 1" }] });
  });

  it("creates key with trimmed name and plan", async () => {
    mocks.createApiKey.mockResolvedValue({ id: "key-1", key: "sk-new", name: "User", planMonths: 3 });

    const response = await adminListRoute.POST(
      request("http://localhost/api/admin/keys", "POST", { name: "  User  ", planMonths: "3" })
    );

    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith("User", "machine-1", { planMonths: 3 });
    expect(await json(response)).toEqual({
      key: { id: "key-1", key: "sk-new", name: "User", planMonths: 3 },
    });
  });

  it("validates create name and plan", async () => {
    const response = await adminListRoute.POST(
      request("http://localhost/api/admin/keys", "POST", { name: " ", planMonths: 2 })
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "Name and valid planMonths are required" });
  });

  it("rejects non-string and too-long create names", async () => {
    const objectName = await adminListRoute.POST(
      request("http://localhost/api/admin/keys", "POST", { name: { label: "User" }, planMonths: 3 })
    );
    const tooLongName = await adminListRoute.POST(
      request("http://localhost/api/admin/keys", "POST", { name: "x".repeat(121), planMonths: 3 })
    );

    expect(objectName.status).toBe(400);
    expect(await json(objectName)).toEqual({ error: "Name and valid planMonths are required" });
    expect(tooLongName.status).toBe(400);
    expect(await json(tooLongName)).toEqual({ error: "Name and valid planMonths are required" });
  });

  it("gets a single key or 404", async () => {
    mocks.getApiKeyById.mockResolvedValueOnce({ id: "key-1" }).mockResolvedValueOnce(null);

    const found = await adminItemRoute.GET(new Request("http://localhost/api/admin/keys/key-1"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const missing = await adminItemRoute.GET(new Request("http://localhost/api/admin/keys/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(found.status).toBe(200);
    expect(await json(found)).toEqual({ key: { id: "key-1" } });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: "Key not found" });
  });

  it("patches supported fields and rejects unsupported fields", async () => {
    mocks.updateApiKey.mockResolvedValue({ id: "key-1", name: "Renamed", isActive: false, planMonths: 6 });

    const updated = await adminItemRoute.PATCH(
      request("http://localhost/api/admin/keys/key-1", "PATCH", {
        name: "  Renamed ",
        isActive: false,
        planMonths: "6",
      }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const invalid = await adminItemRoute.PATCH(
      request("http://localhost/api/admin/keys/key-1", "PATCH", { owner: "wrong" }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", {
      name: "Renamed",
      isActive: false,
      planMonths: 6,
    });
    expect(updated.status).toBe(200);
    expect(await json(updated)).toEqual({
      key: { id: "key-1", name: "Renamed", isActive: false, planMonths: 6 },
    });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toEqual({ error: "Unsupported field: owner" });
  });

  it("rejects non-string and too-long patch names", async () => {
    const objectName = await adminItemRoute.PATCH(
      request("http://localhost/api/admin/keys/key-1", "PATCH", { name: { label: "User" } }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const tooLongName = await adminItemRoute.PATCH(
      request("http://localhost/api/admin/keys/key-1", "PATCH", { name: "x".repeat(121) }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(objectName.status).toBe(400);
    expect(await json(objectName)).toEqual({ error: "Name is required" });
    expect(tooLongName.status).toBe(400);
    expect(await json(tooLongName)).toEqual({ error: "Name must be 120 characters or fewer" });
  });

  it("rejects unauthorized mutating and nested handlers", async () => {
    mocks.requireAdminApiKey.mockResolvedValue(false);

    const createResponse = await adminListRoute.POST(
      request("http://localhost/api/admin/keys", "POST", { name: "User", planMonths: 3 })
    );
    const patchResponse = await adminItemRoute.PATCH(
      request("http://localhost/api/admin/keys/key-1", "PATCH", { name: "Renamed" }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const deleteResponse = await adminItemRoute.DELETE(new Request("http://localhost/api/admin/keys/key-1"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const renewResponse = await adminRenewRoute.POST(
      request("http://localhost/api/admin/keys/key-1/renew", "POST", { planMonths: 12 }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(createResponse.status).toBe(401);
    expect(await json(createResponse)).toEqual({ error: "Unauthorized" });
    expect(patchResponse.status).toBe(401);
    expect(await json(patchResponse)).toEqual({ error: "Unauthorized" });
    expect(deleteResponse.status).toBe(401);
    expect(await json(deleteResponse)).toEqual({ error: "Unauthorized" });
    expect(renewResponse.status).toBe(401);
    expect(await json(renewResponse)).toEqual({ error: "Unauthorized" });
  });

  it("deletes keys and returns 404 when missing", async () => {
    mocks.deleteApiKey.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const deleted = await adminItemRoute.DELETE(new Request("http://localhost/api/admin/keys/key-1"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const missing = await adminItemRoute.DELETE(new Request("http://localhost/api/admin/keys/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(deleted.status).toBe(200);
    expect(await json(deleted)).toEqual({ message: "Key deleted successfully" });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: "Key not found" });
  });

  it("renews key and validates plan", async () => {
    mocks.renewApiKey.mockResolvedValue({ id: "key-1", planMonths: 12 });

    const renewed = await adminRenewRoute.POST(
      request("http://localhost/api/admin/keys/key-1/renew", "POST", { planMonths: 12 }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const invalid = await adminRenewRoute.POST(
      request("http://localhost/api/admin/keys/key-1/renew", "POST", { planMonths: 2 }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(mocks.renewApiKey).toHaveBeenCalledWith("key-1", 12);
    expect(renewed.status).toBe(200);
    expect(await json(renewed)).toEqual({ key: { id: "key-1", planMonths: 12 } });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toEqual({ error: "Valid planMonths is required" });
  });
});
