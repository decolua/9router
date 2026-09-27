import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Claude Code CLI shows the same quota as the claude provider.
 *
 * It was showing counters instead — a bare "5 used", no bar, no percentage, no
 * reset — because its connections carry authType "none" and that was read as
 * "this provider has no upstream quota". It has one: the account is an ordinary
 * Claude subscription and the OAuth usage endpoint answers for it.
 *
 * These cover the three places that had to agree for the card to draw:
 * resolving the credential, asking upstream with it, and parsing what comes
 * back the way the claude provider's payload is parsed.
 */

const updateProviderConnection = vi.fn(async () => {});
const getProviderConnections = vi.fn(async () => []);
vi.mock("@/models", () => ({
  getProviderConnections: (...a) => getProviderConnections(...a),
  updateProviderConnection: (...a) => updateProviderConnection(...a),
}));

const getClaudeUsage = vi.fn();
vi.mock("open-sse/services/usage/claude.js", () => ({
  getClaudeUsage: (...a) => getClaudeUsage(...a),
}));

const routedRows = [];
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({ all: () => routedRows }),
}));

const { claudeCliAccessToken } = await import("@/shared/services/claudeCliAccountRepair");
const { recordRateLimitEvent, resetRateLimitWindows } = await import(
  "open-sse/executors/claudeCliRateLimits.js"
);
const { getClaudeCliUsage } = await import("@/shared/services/claudeCliUsage");
const { parseQuotaData } = await import(
  "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils"
);

const TMP = path.join(os.tmpdir(), `9r-claude-cli-quota-${Date.now()}`);

/** A config directory with a credentials file, as Claude Code writes it. */
async function configDirWith(oauth) {
  const dir = path.join(TMP, Math.random().toString(36).slice(2));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: oauth }));
  return dir;
}

beforeEach(() => {
  getClaudeUsage.mockReset();
  routedRows.length = 0;
  resetRateLimitWindows();
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe("claudeCliAccessToken", () => {
  it("hands over a token account's own credential", async () => {
    expect(await claudeCliAccessToken({ oauthToken: "sk-ant-oat01-tok" }))
      .toBe("sk-ant-oat01-tok");
  });

  it("reads a config-directory account's credential from disk", async () => {
    const configDir = await configDirWith({
      accessToken: "sk-ant-oat01-disk",
      expiresAt: Date.now() + 3600_000,
    });
    expect(await claudeCliAccessToken({ configDir })).toBe("sk-ant-oat01-disk");
  });

  it("treats an expired credential as no credential, rather than asking with it", async () => {
    const configDir = await configDirWith({
      accessToken: "sk-ant-oat01-stale",
      expiresAt: Date.now() - 1000,
    });
    expect(await claudeCliAccessToken({ configDir })).toBeNull();
  });

  it("keeps a credential with no expiry recorded", async () => {
    const configDir = await configDirWith({ accessToken: "sk-ant-oat01-noexp" });
    expect(await claudeCliAccessToken({ configDir })).toBe("sk-ant-oat01-noexp");
  });

  it("returns nothing for an account that has neither", async () => {
    expect(await claudeCliAccessToken({})).toBeNull();
    expect(await claudeCliAccessToken({ configDir: path.join(TMP, "never-made") })).toBeNull();
  });
});

describe("getClaudeCliUsage", () => {
  const realUsage = {
    plan: "Claude Code",
    quotas: {
      "session (5h)": {
        used: 18, total: 100, remaining: 82, remainingPercentage: 82,
        resetAt: "2026-09-23T09:49:59.000Z", unlimited: false,
      },
    },
  };

  it("asks upstream with the account's credential and returns the real windows", async () => {
    getClaudeUsage.mockResolvedValue(realUsage);
    const usage = await getClaudeCliUsage(
      { id: "c1", provider: "claude-cli", providerSpecificData: { oauthToken: "sk-ant-oat01-tok" } },
      null,
      {},
    );
    expect(getClaudeUsage).toHaveBeenCalledWith("sk-ant-oat01-tok", null, { force: false });
    expect(usage.quotas["session (5h)"].remaining).toBe(82);
  });

  it("passes force through, so Recheck bypasses the usage cache", async () => {
    getClaudeUsage.mockResolvedValue(realUsage);
    await getClaudeCliUsage(
      { id: "c1", provider: "claude-cli", providerSpecificData: { oauthToken: "t" } },
      null,
      { force: true },
    );
    expect(getClaudeUsage).toHaveBeenCalledWith("t", null, { force: true });
  });

  it("falls back to counting what it routed when there is no credential", async () => {
    routedRows.push({ cost: 0.01, tokens: JSON.stringify({ total: 30 }), status: "success" });
    const usage = await getClaudeCliUsage({ id: "c1", provider: "claude-cli", providerSpecificData: {} });
    expect(getClaudeUsage).not.toHaveBeenCalled();
    expect(usage.quotas["routed 24h · requests"].used).toBe(1);
  });

  it("uses what the CLI reported when the endpoint will not answer", async () => {
    // A setup-token account: the endpoint refuses it for scope, but the CLI
    // reports the same windows on every routed request.
    getClaudeUsage.mockResolvedValue({ message: "Claude connected. Unable to fetch usage: 403" });
    recordRateLimitEvent({ oauthToken: "t" }, {
      unifiedWindows: {
        five_hour: { utilization: 0.11, resetsAt: 1790172600 },
        seven_day: { utilization: 0.52, resetsAt: 1790319600 },
      },
    });
    const usage = await getClaudeCliUsage(
      { id: "c1", provider: "claude-cli", providerSpecificData: { oauthToken: "t" } },
    );
    expect(usage.quotas["session (5h)"].remaining).toBe(89);
    expect(usage.quotas["weekly (7d)"].remaining).toBe(48);
    expect(usage.message).toMatch(/Reported by Claude Code/);
  });

  it("prefers the endpoint over what the CLI reported, when both exist", async () => {
    getClaudeUsage.mockResolvedValue(realUsage);
    recordRateLimitEvent({ oauthToken: "t" }, {
      unifiedWindows: { five_hour: { utilization: 0.99, resetsAt: 1790172600 } },
    });
    const usage = await getClaudeCliUsage(
      { id: "c1", provider: "claude-cli", providerSpecificData: { oauthToken: "t" } },
    );
    expect(usage.quotas["session (5h)"].remaining).toBe(82);
  });

  it("says a credential was never resolved, rather than falling back in silence", async () => {
    // "no credential to ask with" and "asked and got no answer" look identical
    // on the card otherwise, and they need completely different fixes.
    routedRows.push({ cost: 0, tokens: "{}", status: "success" });
    const usage = await getClaudeCliUsage({ id: "c1", provider: "claude-cli", providerSpecificData: {} });
    expect(usage.message).toMatch(/No credential could be resolved/);
  });

  it("says why the lookup failed when there was a credential to try", async () => {
    getClaudeUsage.mockResolvedValue({ message: "Claude connected. Unable to fetch usage: 401" });
    routedRows.push({ cost: 0, tokens: "{}", status: "success" });
    const usage = await getClaudeCliUsage(
      { id: "c1", provider: "claude-cli", providerSpecificData: { oauthToken: "t" } },
    );
    expect(usage.message).toMatch(/could not be read/);
    expect(usage.message).toMatch(/401/);
  });

  it("falls back rather than showing a soft failure where figures used to be", async () => {
    // getClaudeUsage never throws: a 429 or an expired token comes back as a
    // message. Returning that would replace a working card with an error line.
    getClaudeUsage.mockResolvedValue({ message: "Claude connected. Unable to fetch usage: 429" });
    routedRows.push({ cost: 0, tokens: "{}", status: "success" });
    const usage = await getClaudeCliUsage(
      { id: "c1", provider: "claude-cli", providerSpecificData: { oauthToken: "t" } },
    );
    expect(usage.quotas["routed 24h · requests"].used).toBe(1);
  });
});

describe("the dashboard parses claude-cli exactly as it parses claude", () => {
  const windows = {
    quotas: {
      "weekly (7d)": {
        used: 48, total: 100, remaining: 52, remainingPercentage: 52,
        resetAt: "2026-09-25T06:59:59.000Z", unlimited: false,
      },
      "session (5h)": {
        used: 18, total: 100, remaining: 82, remainingPercentage: 82,
        resetAt: "2026-09-23T09:49:59.000Z", unlimited: false,
      },
    },
  };

  it("keeps the percentage and the reset, which is what draws the bar", () => {
    const parsed = parseQuotaData("claude-cli", windows);
    const session = parsed.find((q) => q.name === "session (5h)");
    expect(session.remaining).toBe(82);
    expect(session.remainingPercentage).toBe(82);
    expect(session.resetAt).toBe("2026-09-23T09:49:59.000Z");
    expect(session.unlimited).toBeUndefined();
  });

  it("orders the windows the way the claude card orders them", () => {
    expect(parseQuotaData("claude-cli", windows).map((q) => q.name))
      .toEqual(["session (5h)", "weekly (7d)"]);
    expect(parseQuotaData("claude", windows).map((q) => q.name))
      .toEqual(["session (5h)", "weekly (7d)"]);
  });

  it("produces the same rows for claude-cli as for claude", () => {
    expect(parseQuotaData("claude-cli", windows)).toEqual(parseQuotaData("claude", windows));
  });

  it("still carries unlimited through for a fallback row, so no bar is drawn", () => {
    const parsed = parseQuotaData("claude-cli", {
      quotas: {
        "routed 24h · requests": {
          used: 3, unlimited: true, remaining: null,
          remainingPercentage: null, resetAt: null, detail: "1 failed",
        },
      },
    });
    expect(parsed[0].unlimited).toBe(true);
    expect(parsed[0].detail).toBe("1 failed");
  });

  it("contributes no row when there is nothing to draw, so the message can show", () => {
    // A payload with only a message used to become a row named "error" —
    // which made the table non-empty, and a non-empty table is exactly the
    // condition the card checks before showing the message instead. So the
    // message never appeared, and in its place sat a red row reading 0 /
    // infinity with a Hide button on it. The message rides on the payload and
    // is rendered from there.
    expect(parseQuotaData("claude-cli", { message: "Unable to fetch usage" })).toEqual([]);
    expect(parseQuotaData("claude", { message: "Unable to fetch usage" })).toEqual([]);
  });
});
