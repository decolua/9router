import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The env/Infisical seed runs on every boot. It must not undo what the operator
 * did in the dashboard: deleting the account, switching it off, renaming it, or
 * marking it schedule-only.
 */

let rows = [];
const kv = new Set();
const created = [];
const updated = [];

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => rows),
  createProviderConnection: vi.fn(async (data) => { created.push(data); }),
  updateProviderConnection: vi.fn(async (id, patch) => { updated.push({ id, patch }); }),
}));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    run: (_sql, [scope, key]) => { kv.add(`${scope}|${key}`); },
    get: (_sql, [scope, key]) => (kv.has(`${scope}|${key}`) ? { hit: 1 } : undefined),
  }),
}));

const TOKEN = "sk-ant-oat01-test-token";

async function boot() {
  delete global.__claudeCliInfisicalSeed;
  vi.resetModules();
  return import("../../src/shared/services/claudeCliInfisicalSeed.js");
}

beforeEach(() => {
  rows = []; kv.clear(); created.length = 0; updated.length = 0;
  process.env.CLAUDE_CLI_OAUTH_TOKEN = TOKEN;
  delete process.env.CLAUDE_CLI_CONFIG_DIR;
});

describe("claude-cli env seed", () => {
  it("creates the account on first boot", async () => {
    const { seedClaudeCliFromEnv } = await boot();
    expect(await seedClaudeCliFromEnv()).toBe("created");
    expect(created).toHaveLength(1);
  });

  it("merges into an existing account and leaves its name, active flag and settings alone", async () => {
    rows = [{
      id: "a", name: "Mine", isActive: false,
      providerSpecificData: { oauthToken: TOKEN, scheduleOnly: true, identity: { email: "x" } },
    }];
    const { seedClaudeCliFromEnv } = await boot();
    expect(await seedClaudeCliFromEnv()).toBe("refreshed");
    const { patch } = updated[0];
    expect(patch.providerSpecificData).toMatchObject({ oauthToken: TOKEN, scheduleOnly: true, identity: { email: "x" } });
    expect(patch).not.toHaveProperty("isActive");
    expect(patch).not.toHaveProperty("name");
  });

  it("does not recreate an account that was deleted from the dashboard", async () => {
    const { dismissSeededCredential } = await boot();
    await dismissSeededCredential({ providerSpecificData: { oauthToken: TOKEN } });
    const { seedClaudeCliFromEnv } = await boot();
    expect(await seedClaudeCliFromEnv()).toBe("dismissed");
    expect(created).toHaveLength(0);
  });

  it("seeds a new secret even after the old one was dismissed", async () => {
    const { dismissSeededCredential } = await boot();
    await dismissSeededCredential({ providerSpecificData: { oauthToken: TOKEN } });
    process.env.CLAUDE_CLI_OAUTH_TOKEN = "sk-ant-oat01-another";
    const { seedClaudeCliFromEnv } = await boot();
    expect(await seedClaudeCliFromEnv()).toBe("created");
  });

  it("ignores deletion of an account the env never seeded", async () => {
    const { dismissSeededCredential } = await boot();
    await dismissSeededCredential({ providerSpecificData: { oauthToken: "something-else" } });
    expect(kv.size).toBe(0);
  });
});
