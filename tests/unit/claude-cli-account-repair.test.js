import { describe, it, expect, vi, beforeEach } from "vitest";
import { FREE_PROVIDERS } from "@/shared/constants/providers";

const updateProviderConnection = vi.fn(async () => {});
const getProviderConnections = vi.fn(async () => []);

vi.mock("@/models", () => ({
  getProviderConnections: (...a) => getProviderConnections(...a),
  updateProviderConnection: (...a) => updateProviderConnection(...a),
}));

const { repairClaudeCliAccounts, repairClaudeCliAccountsOnce, accountSignedIn } =
  await import("@/shared/services/claudeCliAccountRepair");

const broken = (overrides = {}) => ({
  id: "cli-1",
  isActive: false,
  testStatus: "pending",
  providerSpecificData: { oauthToken: "sk-ant-oat01-x", kind: "token" },
  ...overrides,
});

beforeEach(() => {
  updateProviderConnection.mockClear();
  getProviderConnections.mockClear();
});

describe("accountSignedIn", () => {
  it("counts a token as signed in, with no file to look for", async () => {
    expect(await accountSignedIn({ oauthToken: "sk-ant-oat01-x" })).toBe(true);
  });

  it("does not count a config directory that has no credentials file", async () => {
    expect(await accountSignedIn({ configDir: "/nonexistent/path/9router-test" })).toBe(false);
  });

  it("survives being handed nothing", async () => {
    expect(await accountSignedIn()).toBe(false);
    expect(await accountSignedIn({})).toBe(false);
  });
});

describe("repairClaudeCliAccounts", () => {
  it("re-enables an account the old Check disabled", async () => {
    expect(await repairClaudeCliAccounts([broken()])).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("cli-1", expect.objectContaining({
      isActive: true,
      testStatus: "active",
    }));
  });

  // The narrowness is the point: this runs at every boot, so it must not
  // re-enable something switched off deliberately.
  it("leaves an account disabled on purpose alone", async () => {
    expect(await repairClaudeCliAccounts([broken({ testStatus: "active" })])).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("leaves an enabled account alone", async () => {
    expect(await repairClaudeCliAccounts([broken({ isActive: true })])).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not resurrect an account with no credential at all", async () => {
    expect(await repairClaudeCliAccounts([broken({ providerSpecificData: {} })])).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("reads the rows itself when it is not given any", async () => {
    getProviderConnections.mockResolvedValueOnce([broken()]);
    await repairClaudeCliAccounts();
    expect(getProviderConnections).toHaveBeenCalledWith({ provider: "claude-cli" });
  });

  // It runs unconditionally at boot, so a DB hiccup must not take the boot with it.
  it("swallows a failure rather than breaking boot", async () => {
    getProviderConnections.mockRejectedValueOnce(new Error("db is not ready"));
    await expect(repairClaudeCliAccounts()).resolves.toBe(false);
  });
});

/**
 * /api/providers awaits this before reading rows, so it sits on a hot route.
 * The boot path is not enough on its own: initializeApp defers its heavy work
 * by 3s while the Providers list fetches immediately, so the first load after a
 * restart would read a stale row.
 */
describe("repairClaudeCliAccountsOnce", () => {
  it("queries the database once however many callers there are", async () => {
    getProviderConnections.mockResolvedValue([broken()]);
    const results = await Promise.all([
      repairClaudeCliAccountsOnce(),
      repairClaudeCliAccountsOnce(),
      repairClaudeCliAccountsOnce(),
    ]);
    expect(getProviderConnections).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it("stays settled on later calls, so a hot route pays nothing", async () => {
    await repairClaudeCliAccountsOnce();
    getProviderConnections.mockClear();
    await repairClaudeCliAccountsOnce();
    expect(getProviderConnections).not.toHaveBeenCalled();
  });

  // `false` is ambiguous — it is also the ordinary "nothing needed repairing"
  // answer — so a database hiccup must not be cached as a settled result, or
  // the repair is silently off for the life of the process.
  it("does not cache a failure", async () => {
    global.__claudeCliRepair.once = null;
    getProviderConnections.mockRejectedValueOnce(new Error("db is not ready"));
    await expect(repairClaudeCliAccountsOnce()).resolves.toBe(false);

    getProviderConnections.mockResolvedValueOnce([broken()]);
    await expect(repairClaudeCliAccountsOnce()).resolves.toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("cli-1", expect.objectContaining({
      isActive: true,
      testStatus: "active",
    }));
  });
});

/**
 * The provider detail page renders `<ClaudeCliAccountsCard />` — which is where
 * the Schedule button lives — only when `FREE_PROVIDERS[id].noAuth` is true.
 * If that stops holding, the card and its Schedule button silently disappear
 * and the page shows the generic connections list instead.
 */
describe("claude-cli renders the accounts card", () => {
  it("is a free provider flagged noAuth", () => {
    expect(FREE_PROVIDERS["claude-cli"]).toBeTruthy();
    expect(FREE_PROVIDERS["claude-cli"].noAuth).toBe(true);
  });
});
