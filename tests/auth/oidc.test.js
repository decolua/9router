import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings }));

import { getOidcRuntimeConfig } from "../../src/lib/auth/oidc.js";

const oidcSettings = {
  authMode: "sso",
  ssoType: "oidc",
  oidcIssuerUrl: "https://idp.example.com/",
  oidcClientId: "client-id",
  oidcClientSecret: "client-secret",
};

beforeEach(() => getSettings.mockReset());

test("generic SSO mode with ssoType=oidc yields runtime config", async () => {
  getSettings.mockResolvedValue(oidcSettings);

  const config = await getOidcRuntimeConfig();

  assert.equal(config?.issuerUrl, "https://idp.example.com");
  assert.equal(config?.clientId, "client-id");
  assert.equal(config?.scopes, "openid profile email");
});

test("generic SSO mode without an explicit ssoType defaults to oidc", async () => {
  getSettings.mockResolvedValue({ ...oidcSettings, ssoType: undefined });
  assert.ok(await getOidcRuntimeConfig());
});

test("generic SSO mode with ssoType=saml does not yield OIDC config", async () => {
  getSettings.mockResolvedValue({ ...oidcSettings, ssoType: "saml" });
  assert.equal(await getOidcRuntimeConfig(), null);
});

test("legacy authMode=oidc still yields runtime config", async () => {
  getSettings.mockResolvedValue({ ...oidcSettings, authMode: "oidc" });
  assert.ok(await getOidcRuntimeConfig());
});

test("incomplete OIDC credentials still yield no config", async () => {
  getSettings.mockResolvedValue({ ...oidcSettings, oidcClientSecret: "" });
  assert.equal(await getOidcRuntimeConfig(), null);
});
