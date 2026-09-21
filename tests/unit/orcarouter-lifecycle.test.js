import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import orcarouter from "../../src/lib/oauth/providers/orcarouter.js";
import { durableCredentialReauthFields } from "../../open-sse/services/accountFallback.js";
import { credentialHint } from "../../open-sse/providers/orcarouterCatalog.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let repos;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-orcarouter-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  repos = await import("@/lib/db/repos/connectionsRepo.js");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

/** Persist a connection the way the OAuth exchange route does. */
async function persistViaPkce({ key, userId }) {
  const mapped = orcarouter.mapTokens({ key, scope: "api", userId });
  return repos.createProviderConnection({
    provider: "orcarouter",
    authType: "oauth",
    ...mapped,
    expiresAt: null,
    testStatus: "active",
  });
}

/** Persist a connection the way the API-key route does. */
async function persistViaApiKey(apiKey, name = "OrcaRouter API Key") {
  return repos.createProviderConnection({
    provider: "orcarouter",
    authType: "apikey",
    name,
    apiKey,
    isActive: true,
    testStatus: "active",
  });
}

describe("orcarouter credential persistence", () => {
  it("stores a PKCE key as a durable credential with no refresh token", async () => {
    const conn = await persistViaPkce({ key: "sk-orca-fake-pkce-1", userId: "1001" });
    expect(conn.accessToken).toBe("sk-orca-fake-pkce-1");
    expect(conn.apiKey).toBe("sk-orca-fake-pkce-1");
    // No refresh token is invented for a durable key.
    expect(conn.refreshToken ?? null).toBeNull();
    expect(conn.providerSpecificData.authMethod).toBe("pkce");
    expect(conn.providerSpecificData.grantedScope).toBe("api");
  });

  it("stores an API-key adapter credential on the same provider", async () => {
    const conn = await persistViaApiKey("sk-orca-fake-manual-1");
    expect(conn.apiKey).toBe("sk-orca-fake-manual-1");
    expect(conn.authType).toBe("apikey");
    expect(conn.provider).toBe("orcarouter");
  });

  it("reuses one account row when the same user signs in again", async () => {
    const first = await persistViaPkce({ key: "sk-orca-fake-a", userId: "2002" });
    const second = await persistViaPkce({ key: "sk-orca-fake-b", userId: "2002" });
    // Same row, rotated credential — not a second account.
    expect(second.id).toBe(first.id);
    expect(second.accessToken).toBe("sk-orca-fake-b");

    const { getProviderConnections } = repos;
    const all = await getProviderConnections({ provider: "orcarouter" });
    expect(all.filter((c) => c.providerSpecificData?.userId === "2002")).toHaveLength(1);
  });

  it("keeps distinct accounts for distinct users", async () => {
    const a = await persistViaPkce({ key: "sk-orca-fake-u1", userId: "3001" });
    const b = await persistViaPkce({ key: "sk-orca-fake-u2", userId: "3002" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("orcarouter revoked-key lifecycle", () => {
  it("marks the exact rejected account for reauthentication on 401", async () => {
    const target = await persistViaPkce({ key: "sk-orca-revoked", userId: "4001" });
    const other = await persistViaPkce({ key: "sk-orca-healthy", userId: "4002" });

    // The rejected request presented exactly the stored credential.
    const fields = durableCredentialReauthFields(target, "sk-orca-revoked", 401);
    expect(fields.needsReauth).toBe(true);
    await repos.updateProviderConnection(target.id, {
      testStatus: "unavailable",
      lastError: "OrcaRouter credential rejected — sign in again",
      errorCode: 401,
      ...fields,
    });

    const after = await repos.getProviderConnectionById(target.id);
    expect(after.needsReauth).toBe(true);
    expect(after.reauthReason).toBe("credential_rejected");
    expect(after.errorCode).toBe(401);
    // The other account is untouched — the transition is exact-account.
    const untouched = await repos.getProviderConnectionById(other.id);
    expect(untouched.needsReauth ?? false).toBe(false);

    // A rejected durable key must not be silently deleted.
    expect(after.accessToken).toBe("sk-orca-revoked");
  });

  it("does not flag a credential the user has already replaced", async () => {
    const conn = await persistViaPkce({ key: "sk-orca-new-gen", userId: "5001" });
    // A late failure from the previous generation arrives after the re-login.
    const late = durableCredentialReauthFields(conn, "sk-orca-old-gen", 401);
    expect(late).toBeNull();

    const after = await repos.getProviderConnectionById(conn.id);
    expect(after.needsReauth ?? false).toBe(false);
    expect(after.accessToken).toBe("sk-orca-new-gen");
  });

  it("clears the reauthentication flag once a new login succeeds", async () => {
    const conn = await persistViaPkce({ key: "sk-orca-broken", userId: "6001" });
    await repos.updateProviderConnection(conn.id, {
      testStatus: "unavailable",
      ...durableCredentialReauthFields(conn, "sk-orca-broken", 401),
    });
    expect((await repos.getProviderConnectionById(conn.id)).needsReauth).toBe(true);

    // User re-authenticates: the same row is reactivated with a fresh key.
    await persistViaPkce({ key: "sk-orca-fixed", userId: "6001" });
    const after = await repos.getProviderConnectionById(conn.id);
    expect(after.needsReauth).toBe(false);
    expect(after.reauthReason ?? null).toBeNull();
    expect(after.accessToken).toBe("sk-orca-fixed");
    expect(after.testStatus).toBe("active");
  });

  it("stores a redacted key hint that never contains the secret", async () => {
    const secret = "sk-orca-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const conn = await repos.createProviderConnection({
      provider: "orcarouter",
      authType: "apikey",
      name: "hint check",
      apiKey: secret,
      accessToken: secret,
      testStatus: "active",
    });

    const after = await repos.getProviderConnectionById(conn.id);
    // The hint is what the browser is allowed to render…
    expect(after.keyHint).toBe("sk-orca-…6789");
    expect(after.keyHint).not.toContain("ABCDEFGH");
    // …while the secret itself stays server-side and is never in the hint.
    expect(after.keyHint.length).toBeLessThan(secret.length);
  });

  it("omits the hint for a credential too short to redact safely", async () => {
    expect(credentialHint("sk-orca-abc")).toBeNull();
    expect(credentialHint(undefined)).toBeNull();
    expect(credentialHint("")).toBeNull();
  });

  it("keeps the stored hint stable when the connection is updated", async () => {
    const secret = "sk-orca-live-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ1111";
    const conn = await repos.createProviderConnection({
      provider: "orcarouter",
      authType: "apikey",
      name: "hint stable",
      apiKey: secret,
      accessToken: secret,
      testStatus: "active",
    });
    const first = (await repos.getProviderConnectionById(conn.id)).keyHint;

    await repos.updateProviderConnection(conn.id, { priority: 3 });
    expect((await repos.getProviderConnectionById(conn.id)).keyHint).toBe(first);
  });

  it("replaces the hint when the stored key changes", async () => {
    const conn = await repos.createProviderConnection({
      provider: "orcarouter",
      authType: "apikey",
      name: "hint replace",
      apiKey: "sk-orca-live-AAAAAAAAAAAAAAAAAAAAAAAAAAAA9999",
      accessToken: "sk-orca-live-AAAAAAAAAAAAAAAAAAAAAAAAAAAA9999",
      testStatus: "active",
    });
    expect((await repos.getProviderConnectionById(conn.id)).keyHint).toBe("sk-orca-…9999");

    // A new key must never leave a hint describing the previous secret.
    await repos.updateProviderConnection(conn.id, {
      apiKey: "sk-orca-live-BBBBBBBBBBBBBBBBBBBBBBBBBBBB7777",
      accessToken: "sk-orca-live-BBBBBBBBBBBBBBBBBBBBBBBBBBBB7777",
    });
    const after = await repos.getProviderConnectionById(conn.id);
    expect(after.keyHint).toBe("sk-orca-…7777");
    expect(after.keyHint).not.toContain("9999");
  });
});
