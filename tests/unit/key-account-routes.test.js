import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), get: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  createApiKey: fx.create, updateApiKey: fx.update, getApiKeyById: fx.get,
  getApiKeys: vi.fn(), deleteApiKey: vi.fn(),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "machine-1" }));
const { POST } = await import("@/app/api/keys/route.js");
const { PUT } = await import("@/app/api/keys/[id]/route.js");
const request = (body) => new Request("http://localhost/api/keys", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const accountAccess = { restricted: false, allow: [], accountsRestricted: true, accountIds: ["account-A"] };

beforeEach(() => {
  vi.clearAllMocks();
  fx.create.mockImplementation(async (name, machineId, access) => ({ id: "k1", key: "sk-test", name, machineId, access }));
  fx.get.mockResolvedValue({ id: "k1", access: accountAccess });
  fx.update.mockImplementation(async (id, data) => ({ id, ...data }));
});

describe("API key account policy routes", () => {
  it("creates account-restricted keys in one write", async () => {
    const response = await POST(request({ name: "limited", access: accountAccess }));
    expect(response.status).toBe(201);
    expect(fx.create).toHaveBeenCalledWith("limited", "machine-1", accountAccess);
    expect((await response.json()).access).toEqual(accountAccess);
  });
  it("rejects invalid account policies before writing", async () => {
    for (const access of [{ ...accountAccess, accountsRestricted: "true" }, { ...accountAccess, accountIds: [3] }]) {
      expect((await POST(request({ name: "bad", access }))).status).toBe(400);
      expect((await PUT(request({ access }), { params: Promise.resolve({ id: "k1" }) })).status).toBe(400);
    }
    expect(fx.create).not.toHaveBeenCalled();
    expect(fx.update).not.toHaveBeenCalled();
  });
  it("keeps account policy when legacy clients update model policy", async () => {
    const response = await PUT(request({ access: { restricted: true, allow: ["Main"] } }), { params: Promise.resolve({ id: "k1" }) });
    expect(response.status).toBe(200);
    expect(fx.update).toHaveBeenCalledWith("k1", { access: { ...accountAccess, restricted: true, allow: ["Main"] } });
  });
  it("allows explicit account deny-all independently of model policy", async () => {
    const response = await PUT(request({ access: { restricted: false, accountsRestricted: true, accountIds: [] } }), { params: Promise.resolve({ id: "k1" }) });
    expect(response.status).toBe(200);
    expect(fx.update).toHaveBeenCalledWith("k1", { access: { ...accountAccess, accountIds: [] } });
  });
});
