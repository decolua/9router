import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * "Schedule only": a claude-cli account stays active (so the keepalive
 * scheduler keeps pinging it) but is never handed out for real LLM traffic.
 * The scheduler reads active rows directly; routing goes through
 * getProviderCredentials, which must skip these rows — including not falling
 * back to the synthetic no-auth "Public" connection.
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

const row = (over) => ({
  id: "c1", provider: "claude-cli", isActive: true, authType: "none", testStatus: "active",
  providerSpecificData: {}, ...over,
});
const scheduleOnly = { scheduleOnly: true };

beforeEach(() => { rows = []; });

describe("claude-cli scheduleOnly accounts", () => {
  it("are not used for LLM calls when they are the only accounts", async () => {
    rows = [row({ id: "s", providerSpecificData: scheduleOnly })];
    expect(await getProviderCredentials("claude-cli", null, "claude-cli-haiku")).toBeNull();
    expect(await getProviderCredentials("ccli", null, "claude-cli-haiku")).toBeNull();
  });

  it("are skipped in favour of a normal account", async () => {
    rows = [
      row({ id: "s", providerSpecificData: scheduleOnly }),
      row({ id: "n" }),
    ];
    for (let i = 0; i < 5; i++) {
      const creds = await getProviderCredentials("claude-cli", null, "claude-cli-haiku");
      expect(creds?.connectionId).toBe("n");
    }
  });

  it("stay active, so the scheduler (which reads active rows) still sees them", async () => {
    rows = [row({ id: "s", providerSpecificData: scheduleOnly })];
    const { getProviderConnections } = await import("@/lib/localDb");
    const active = await getProviderConnections({ provider: "claude-cli", isActive: true });
    expect(active.map((c) => c.id)).toEqual(["s"]);
  });

  it("only exclude the flagged account, not the provider", async () => {
    rows = [
      row({ id: "s", providerSpecificData: scheduleOnly }),
      row({ id: "n", providerSpecificData: { scheduleOnly: false } }),
    ];
    const creds = await getProviderCredentials("claude-cli", null, "claude-cli-haiku");
    expect(creds?.connectionId).toBe("n");
  });
});
