import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
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
    mocks.updateSettings.mockImplementation(async (updates) => updates);

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    expect(result.key.startsWith("9r-admin-")).toBe(true);
    expect(result.status.configured).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      adminApiKeyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-23T00:00:00.000Z",
    }));
    expect(mocks.updateSettings.mock.calls[0][0].adminApiKeyHash).not.toContain(result.key);
    expect(result.status).not.toHaveProperty("adminApiKeyHash");
  });

  it("verifies the generated key against stored hash", async () => {
    let savedSettings = {};
    mocks.updateSettings.mockImplementation(async (updates) => {
      savedSettings = { ...savedSettings, ...updates };
      return savedSettings;
    });
    mocks.getSettings.mockImplementation(async () => savedSettings);

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
    let savedSettings = {};
    mocks.updateSettings.mockImplementation(async (updates) => {
      savedSettings = { ...savedSettings, ...updates };
      return savedSettings;
    });
    mocks.getSettings.mockImplementation(async () => savedSettings);

    const result = await createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));

    await expect(requireAdminApiKey(request({ authorization: `Bearer ${result.key}` }))).resolves.toBe(true);
    await expect(requireAdminApiKey(request({ authorization: "Bearer wrong" }))).resolves.toBe(false);
  });

  it("serializes concurrent rotations", async () => {
    let savedSettings = {};
    let firstUpdateStarted;
    let releaseFirstUpdate;
    const firstUpdateStartedPromise = new Promise((resolve) => {
      firstUpdateStarted = resolve;
    });
    const releaseFirstUpdatePromise = new Promise((resolve) => {
      releaseFirstUpdate = resolve;
    });

    mocks.getSettings.mockImplementation(async () => ({ ...savedSettings }));
    mocks.updateSettings.mockImplementation(async (updates) => {
      if (mocks.updateSettings.mock.calls.length === 1) {
        firstUpdateStarted();
        await releaseFirstUpdatePromise;
      }
      savedSettings = { ...savedSettings, ...updates };
      return savedSettings;
    });

    const first = createOrRotateAdminApiKey(new Date("2026-06-23T00:00:00.000Z"));
    await firstUpdateStartedPromise;
    const second = createOrRotateAdminApiKey(new Date("2026-06-24T00:00:00.000Z"));

    releaseFirstUpdate();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });
    expect(secondResult.status).toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
  });

  it("returns safe status only", async () => {
    mocks.getSettings.mockResolvedValue({
      adminApiKeyHash: "sha256:secret",
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
    });

    await expect(getAdminApiKeyStatus()).resolves.toEqual({
      configured: true,
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
  });
});
