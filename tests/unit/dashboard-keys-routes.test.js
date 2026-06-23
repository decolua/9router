import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 })),
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

const keysRoute = await import("../../src/app/api/keys/route.js");
const keyItemRoute = await import("../../src/app/api/keys/[id]/route.js");

function request(url, method, body) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

describe("dashboard key routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("machine-1");
  });

  it("creates keys with plan metadata while preserving the top-level key string", async () => {
    const apiKey = {
      id: "key-1",
      key: "sk-new",
      name: "User",
      machineId: "machine-1",
      isActive: true,
      planMonths: 3,
      expiresAt: "2026-09-18T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
    };
    mocks.createApiKey.mockResolvedValue(apiKey);

    const response = await keysRoute.POST(
      request("http://localhost/api/keys", "POST", { name: "  User  ", planMonths: "3" })
    );

    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith("User", "machine-1", { planMonths: 3 });
    expect(await json(response)).toEqual({
      key: "sk-new",
      name: "User",
      id: "key-1",
      machineId: "machine-1",
      isActive: true,
      planMonths: 3,
      expiresAt: "2026-09-18T00:00:00.000Z",
      deactivatedReason: null,
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      apiKey,
    });
  });

  it("validates create names and plans", async () => {
    const blankName = await keysRoute.POST(
      request("http://localhost/api/keys", "POST", { name: " ", planMonths: 1 })
    );
    const objectName = await keysRoute.POST(
      request("http://localhost/api/keys", "POST", { name: { label: "User" }, planMonths: 1 })
    );
    const tooLongName = await keysRoute.POST(
      request("http://localhost/api/keys", "POST", { name: "x".repeat(121), planMonths: 1 })
    );
    const invalidPlan = await keysRoute.POST(
      request("http://localhost/api/keys", "POST", { name: "User", planMonths: 2 })
    );

    expect(blankName.status).toBe(400);
    expect(await json(blankName)).toEqual({ error: "Name is required" });
    expect(objectName.status).toBe(400);
    expect(await json(objectName)).toEqual({ error: "Name is required" });
    expect(tooLongName.status).toBe(400);
    expect(await json(tooLongName)).toEqual({ error: "Name must be 120 characters or fewer" });
    expect(invalidPlan.status).toBe(400);
    expect(await json(invalidPlan)).toEqual({ error: "Valid planMonths is required" });
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });

  it("updates supported fields with validation", async () => {
    mocks.getApiKeyById.mockResolvedValue({ id: "key-1" });
    mocks.updateApiKey.mockResolvedValue({ id: "key-1", name: "Renamed", isActive: false, planMonths: 6 });

    const response = await keyItemRoute.PUT(
      request("http://localhost/api/keys/key-1", "PUT", {
        name: "  Renamed  ",
        isActive: false,
        planMonths: "6",
      }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", {
      name: "Renamed",
      isActive: false,
      planMonths: 6,
    });
    expect(await json(response)).toEqual({
      key: { id: "key-1", name: "Renamed", isActive: false, planMonths: 6 },
    });
  });

  it("rejects invalid update names and plans", async () => {
    mocks.getApiKeyById.mockResolvedValue({ id: "key-1" });

    const blankName = await keyItemRoute.PUT(
      request("http://localhost/api/keys/key-1", "PUT", { name: " " }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const objectName = await keyItemRoute.PUT(
      request("http://localhost/api/keys/key-1", "PUT", { name: { label: "User" } }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const tooLongName = await keyItemRoute.PUT(
      request("http://localhost/api/keys/key-1", "PUT", { name: "x".repeat(121) }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const invalidPlan = await keyItemRoute.PUT(
      request("http://localhost/api/keys/key-1", "PUT", { planMonths: 2 }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(blankName.status).toBe(400);
    expect(await json(blankName)).toEqual({ error: "Name is required" });
    expect(objectName.status).toBe(400);
    expect(await json(objectName)).toEqual({ error: "Name is required" });
    expect(tooLongName.status).toBe(400);
    expect(await json(tooLongName)).toEqual({ error: "Name must be 120 characters or fewer" });
    expect(invalidPlan.status).toBe(400);
    expect(await json(invalidPlan)).toEqual({ error: "Valid planMonths is required" });
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("renews keys and reports missing or invalid renewals", async () => {
    mocks.renewApiKey
      .mockResolvedValueOnce({ id: "key-1", planMonths: 12 })
      .mockResolvedValueOnce(null);

    const renewed = await keyItemRoute.POST(
      request("http://localhost/api/keys/key-1", "POST", { planMonths: "12" }),
      { params: Promise.resolve({ id: "key-1" }) }
    );
    const missing = await keyItemRoute.POST(
      request("http://localhost/api/keys/missing", "POST", { planMonths: 1 }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    const invalid = await keyItemRoute.POST(
      request("http://localhost/api/keys/key-1", "POST", { planMonths: 2 }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(mocks.renewApiKey).toHaveBeenCalledWith("key-1", 12);
    expect(renewed.status).toBe(200);
    expect(await json(renewed)).toEqual({ key: { id: "key-1", planMonths: 12 } });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: "Key not found" });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toEqual({ error: "Valid planMonths is required" });
  });
});
