import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let cleanup = () => {};

async function setupTestDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-codex-connections-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/localDb.js");

  return {
    ...db,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
}

describe("Codex provider connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps separate Codex workspaces for the same email", async () => {
    const db = await setupTestDb();
    cleanup = db.cleanup;

    await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "user@example.com",
      accessToken: "workspace-a-access-token",
      refreshToken: "workspace-a-refresh-token",
      providerSpecificData: {
        chatgptAccountId: "account-a",
        organizationId: "workspace-a",
      },
    });

    await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "user@example.com",
      accessToken: "workspace-b-access-token",
      refreshToken: "workspace-b-refresh-token",
      providerSpecificData: {
        chatgptAccountId: "account-a",
        organizationId: "workspace-b",
      },
    });

    const connections = await db.getProviderConnections({ provider: "codex" });

    expect(connections).toHaveLength(2);
    expect(connections.map((c) => c.providerSpecificData.organizationId).sort()).toEqual([
      "workspace-a",
      "workspace-b",
    ]);
  });

  it("updates the same Codex workspace when account and workspace match", async () => {
    const db = await setupTestDb();
    cleanup = db.cleanup;

    const first = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "user@example.com",
      accessToken: "old-token",
      providerSpecificData: {
        chatgptAccountId: "account-a",
        organizationId: "workspace-a",
      },
    });

    const second = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "user@example.com",
      accessToken: "new-token",
      providerSpecificData: {
        chatgptAccountId: "account-a",
        organizationId: "workspace-a",
      },
    });

    const connections = await db.getProviderConnections({ provider: "codex" });

    expect(second.id).toBe(first.id);
    expect(connections).toHaveLength(1);
    expect(connections[0].accessToken).toBe("new-token");
  });

  it("extracts Codex account and workspace metadata from id_token", async () => {
    vi.resetModules();
    const { extractCodexAccountInfo } = await import("@/lib/oauth/providers.js");
    const idToken = makeJwt({
      email: "user@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-a",
        chatgpt_plan_type: "plus",
        organizations: [{ id: "workspace-a", name: "Workspace A" }],
      },
    });

    expect(extractCodexAccountInfo(idToken)).toEqual({
      email: "user@example.com",
      chatgptAccountId: "account-a",
      chatgptPlanType: "plus",
      organizationId: "workspace-a",
      organizationName: "Workspace A",
    });
  });
});
