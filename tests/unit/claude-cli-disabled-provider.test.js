import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A no-auth provider has no credential to be missing, so a synthetic "Public"
 * connection stands in when it has no accounts. That stand-in must not also
 * answer for an operator who *turned the provider off*: claude-cli's accounts
 * are real rows, and switching them all off left zero active rows — which read
 * as "no accounts at all", so every combo step kept sending to it while every
 * other provider was skipped.
 */

let rows = [];

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async (filter = {}) => rows.filter((r) =>
    (!filter.provider || r.provider === filter.provider)
    && (filter.isActive === undefined || Boolean(r.isActive) === Boolean(filter.isActive)))),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const row = (over) => ({ id: "c1", provider: "claude-cli", isActive: true, authType: "none", providerSpecificData: {}, ...over });

beforeEach(() => { rows = []; });

describe("a no-auth provider whose accounts exist", () => {
  it("is skipped (no credentials) when every account is switched off", async () => {
    rows = [row({ id: "a", isActive: false }), row({ id: "b", isActive: false })];
    expect(await getProviderCredentials("claude-cli", null, "claude-cli-haiku")).toBeNull();
    expect(await getProviderCredentials("ccli", null, "claude-cli-haiku")).toBeNull();
  });

  it("uses the account that is on, not the synthetic one", async () => {
    rows = [row({ id: "a", isActive: false }), row({ id: "b", isActive: true })];
    const creds = await getProviderCredentials("claude-cli", null, "claude-cli-haiku");
    expect(creds?.connectionId).toBe("b");
  });

  it("does not read an account whose login has not finished as 'switched off'", async () => {
    // "Add account" creates an inactive row, testStatus pending, until the login
    // completes. Nobody turned anything off; the host's own login keeps serving.
    rows = [row({ id: "new", isActive: false, testStatus: "pending" })];
    const creds = await getProviderCredentials("claude-cli", null, "claude-cli-haiku");
    expect(creds?.id).toBe("noauth");
  });

  it("is off when one was switched off, even beside an unfinished login", async () => {
    rows = [row({ id: "new", isActive: false, testStatus: "pending" }), row({ id: "old", isActive: false, testStatus: "active" })];
    expect(await getProviderCredentials("claude-cli", null, "claude-cli-haiku")).toBeNull();
  });

  it("still stands in a synthetic connection when it has no accounts at all", async () => {
    const creds = await getProviderCredentials("claude-cli", null, "claude-cli-haiku");
    expect(creds?.id).toBe("noauth");
  });
});
