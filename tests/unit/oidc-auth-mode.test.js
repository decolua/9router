import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

const { getOidcRuntimeConfig, isOidcAuthMode } = await import("../../src/lib/auth/oidc.js");

const configuredOidcSettings = {
  oidcIssuerUrl: "https://idp.example.com/application/o/9router/",
  oidcClientId: "client-id",
  oidcClientSecret: "client-secret",
};

describe("isOidcAuthMode", () => {
  it("accepts every auth mode the dashboard writes for OIDC login", () => {
    expect(isOidcAuthMode("sso")).toBe(true);
    expect(isOidcAuthMode("oidc")).toBe(true);
    expect(isOidcAuthMode("both")).toBe(true);
  });

  it("rejects password-only and missing auth modes", () => {
    expect(isOidcAuthMode("password")).toBe(false);
    expect(isOidcAuthMode(undefined)).toBe(false);
  });
});

describe("getOidcRuntimeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a config when SSO is the only login method", async () => {
    mocks.getSettings.mockResolvedValue({ ...configuredOidcSettings, authMode: "sso" });

    const config = await getOidcRuntimeConfig();

    expect(config).not.toBeNull();
    expect(config.issuerUrl).toBe("https://idp.example.com/application/o/9router");
    expect(config.clientId).toBe("client-id");
  });

  it("resolves a config when password and SSO login are both enabled", async () => {
    mocks.getSettings.mockResolvedValue({ ...configuredOidcSettings, authMode: "both" });

    expect(await getOidcRuntimeConfig()).not.toBeNull();
  });

  it("returns null for password-only login", async () => {
    mocks.getSettings.mockResolvedValue({ ...configuredOidcSettings, authMode: "password" });

    expect(await getOidcRuntimeConfig()).toBeNull();
  });

  it("returns null when SSO is enabled but OIDC credentials are missing", async () => {
    mocks.getSettings.mockResolvedValue({ authMode: "sso", oidcIssuerUrl: "" });

    expect(await getOidcRuntimeConfig()).toBeNull();
  });
});
