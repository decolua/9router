import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  applyOutboundProxyEnv: vi.fn(),
  getSettings: vi.fn(),
  resetComboRotation: vi.fn(),
  updateSettings: vi.fn(),
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
    compare: vi.fn(),
    genSalt: vi.fn(),
    hash: vi.fn(),
  },
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
    },
  },
}));

const { GET, PATCH } = await import("../../src/app/api/settings/route.js");

function patchRequest(body) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settings route admin auth protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not expose admin api key metadata from generic settings GET", async () => {
    mocks.getSettings.mockResolvedValue({
      adminApiKeyHash: "sha256:secret",
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
      password: "password-hash",
      oidcClientSecret: "oidc-secret",
      oidcIssuerUrl: "https://issuer.test",
      oidcClientId: "client-id",
      theme: "dark",
    });

    const response = await GET();
    const body = await response.json();

    expect(body).toMatchObject({
      theme: "dark",
      oidcConfigured: true,
      hasPassword: true,
    });
    expect(body).not.toHaveProperty("adminApiKeyHash");
    expect(body).not.toHaveProperty("adminApiKeyCreatedAt");
    expect(body).not.toHaveProperty("adminApiKeyUpdatedAt");
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("oidcClientSecret");
  });

  it("does not allow generic settings PATCH to mutate admin api key metadata", async () => {
    mocks.updateSettings.mockImplementation(async (updates) => ({
      ...updates,
      adminApiKeyHash: "sha256:stored",
      adminApiKeyCreatedAt: "2026-06-23T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-06-24T00:00:00.000Z",
    }));

    const response = await PATCH(patchRequest({
      theme: "light",
      adminApiKeyHash: "sha256:attacker",
      adminApiKeyCreatedAt: "2026-01-01T00:00:00.000Z",
      adminApiKeyUpdatedAt: "2026-01-02T00:00:00.000Z",
    }));
    const body = await response.json();

    expect(mocks.updateSettings).toHaveBeenCalledWith({ theme: "light" });
    expect(body).toMatchObject({ theme: "light" });
    expect(body).not.toHaveProperty("adminApiKeyHash");
    expect(body).not.toHaveProperty("adminApiKeyCreatedAt");
    expect(body).not.toHaveProperty("adminApiKeyUpdatedAt");
  });
});
