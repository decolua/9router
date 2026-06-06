import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  hash: vi.fn(),
  genSalt: vi.fn(),
  compare: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
}));

vi.mock("bcryptjs", () => ({
  default: {
    genSalt: mocks.genSalt,
    hash: mocks.hash,
    compare: mocks.compare,
  },
}));

const { PATCH } = await import("../../src/app/api/settings/route.js");

function request(body) {
  return { json: vi.fn(async () => body) };
}

describe("settings API patch validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ password: "$2a$hash", requireLogin: true });
    mocks.updateSettings.mockImplementation(async (body) => body);
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("hashed-password");
    mocks.compare.mockResolvedValue(true);
  });

  it("rejects raw password field updates", async () => {
    const response = await PATCH(request({ password: "plaintext" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unsupported setting: password");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects unknown settings fields", async () => {
    const response = await PATCH(request({ customField: "x" }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Unsupported setting: customField");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("hashes password changes through the newPassword path", async () => {
    const response = await PATCH(request({ currentPassword: "old", newPassword: "new" }));

    expect(response.status).toBe(200);
    expect(mocks.compare).toHaveBeenCalledWith("old", "$2a$hash");
    expect(mocks.updateSettings).toHaveBeenCalledWith({ password: "hashed-password" });
  });
});
