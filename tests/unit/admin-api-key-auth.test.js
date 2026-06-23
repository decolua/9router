import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  rotateAdminApiKeySettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  rotateAdminApiKeySettings: mocks.rotateAdminApiKeySettings,
  updateSettings: mocks.updateSettings,
}));

const {
  createOrRotateAdminApiKey,
  extractAdminApiKey,
  getAdminApiKeyStatus,
  requireAdminApiKey,
  verifyAdminApiKey,
} = await import("../../src/lib/auth/adminApiKey.js");

function request(headers = {}) {
  return { headers: new Headers(headers) };
}

function mockRotation({ settingsBox = { value: {} }, trackUpdate = false } = {}) {
  mocks.rotateAdminApiKeySettings.mockImplementation(async ({ now, generateKey, hashKey }) => {
    const key = generateKey();
    const timestamp = now.toISOString();
    const updates = {
      adminApiKeyHash: hashKey(key),
      adminApiKeyCreatedAt: settingsBox.value.adminApiKeyCreatedAt || timestamp,
      adminApiKeyUpdatedAt: timestamp,
    };
    settingsBox.value = { ...settingsBox.value, ...updates };
    if (trackUpdate) mocks.updateSettings(updates);
    return {
      key,
      status: {
        configured: true,
        createdAt: updates.adminApiKeyCreatedAt,
        updatedAt: updates.adminApiKeyUpdatedAt,
      },
    };
  });
  mocks.getSettings.mockImplementation(async () => settingsBox.value);
  return settingsBox;
}

describe("admin API key auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts bearer key before x-admin-api-key", () => {
    const req = request({
      authorization: "Bearer admin-bearer",
      "x-admin-api-key": "admin-header",
    });
    expect(extractAdminApiKey(req)).toBe("admin-bearer");
  });

  it("extracts x-admin-api-key when bearer is missing", () => {
    expect(extractAdminApiKey(request({ "x-admin-api-key": "admin-header" }))).toBe("admin-header");
  });

  it("extracts lowercase bearer with extra spaces", () => {
    expect(extractAdminApiKey(request({ authorization: "bearer   admin-lower  " }))).toBe("admin-lower");
  });

  it("falls back to x-admin-api-key when bearer is empty or malformed", () => {
    expect(extractAdminApiKey(request({
      authorization: "Bearer    ",
      "x-admin-api-key": "admin-header",
    }))).toBe("admin-header");
    expect(extractAdminApiKey(request({
      authorization: "Basic admin-basic",
      "x-admin-api-key": "admin-header",
    }))).toBe("admin-header");
  });

  it("creates one plaintext key and stores only hash metadata", async () => {
    mockRotation({ trackUpdate: true });

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    expect(result.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.key.startsWith("9r-admin-")).toBe(false);
    expect(result.status.configured).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      adminApiKeyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-23T00:00:00.000Z",
    }));
    expect(mocks.updateSettings.mock.calls[0][0].adminApiKeyHash).not.toContain(result.key);
    expect(result.status).not.toHaveProperty("adminApiKeyHash");
    expect(mocks.rotateAdminApiKeySettings).toHaveBeenCalledWith(expect.objectContaining({
      now: new Date("2026-06-23T00:00:00.000Z"),
      expectedUpdatedAt: "",
      generateKey: expect.any(Function),
      hashKey: expect.any(Function),
    }));
  });

  it("verifies the generated key against stored hash", async () => {
    mockRotation();

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    await expect(verifyAdminApiKey(result.key)).resolves.toBe(true);
    await expect(verifyAdminApiKey("wrong")).resolves.toBe(false);
  });

  it("returns false without key or stored settings", async () => {
    mocks.getSettings.mockResolvedValue(null);

    await expect(verifyAdminApiKey("")).resolves.toBe(false);
    await expect(verifyAdminApiKey("admin-key")).resolves.toBe(false);
  });

  it("returns false for malformed stored hashes", async () => {
    mocks.getSettings.mockResolvedValue({ adminApiKeyHash: "sha256:secret" });

    await expect(verifyAdminApiKey("admin-key")).resolves.toBe(false);
  });

  it("requires admin api key from requests", async () => {
    mockRotation();

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    await expect(requireAdminApiKey(request({ authorization: `Bearer ${result.key}` }))).resolves.toBe(true);
    await expect(requireAdminApiKey(request({ authorization: "Bearer wrong" }))).resolves.toBe(false);
  });

  it("defaults rotations to the current settings version", async () => {
    mocks.getSettings.mockResolvedValue({ adminApiKeyUpdatedAt: "2026-06-22T00:00:00.000Z" });
    mocks.rotateAdminApiKeySettings.mockResolvedValue({
      key: "admin-key",
      status: {
        configured: true,
        createdAt: "2026-06-22T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    });

    await expect(createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"))).resolves.toMatchObject({
      key: "admin-key",
    });
    expect(mocks.rotateAdminApiKeySettings).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: "2026-06-22T00:00:00.000Z",
    }));
  });

  it("returns safe status only", async () => {
    mocks.getSettings.mockResolvedValue({
      adminApiKeyHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
    });

    await expect(getAdminApiKeyStatus()).resolves.toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
  });

  it("reports unconfigured status for malformed stored hashes", async () => {
    mocks.getSettings.mockResolvedValue({
      adminApiKeyHash: "sha256:secret",
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
    });

    await expect(getAdminApiKeyStatus()).resolves.toEqual({
      configured: false,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
  });
});
