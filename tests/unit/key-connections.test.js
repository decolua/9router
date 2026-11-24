import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateKeyPolicy } from "@/shared/utils/keyPolicy.js";

const dir = mkdtempSync(join(tmpdir(), "key-connections-"));
let db, repo, update, list, admin, viewer, select, withKey;

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("JWT_SECRET", "key-pin-test-dashboard-session-secret");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/index.js");
  ({ PUT: update } = await import("@/app/api/keys/[id]/route.js"));
  ({ GET: list } = await import("@/app/api/keys/route.js"));
  const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession");
  admin = await createDashboardAuthToken({ role: "admin" });
  viewer = await createDashboardAuthToken({ role: "viewer" });
  ({ getProviderCredentials: select } = await import("@/sse/services/auth.js"));
  const { startInference } = await import("@/lib/observability/requestContext.js");
  const { readRequestKey } = await import("@/sse/services/requestKey.js");
  withKey = (key, run) => {
    const request = new Request("http://localhost/v1/chat/completions", { headers: { "x-api-key": key.key } });
    return startInference(request, async () => {
      await readRequestKey(request);
      return run();
    });
  };
}, 30000);

afterAll(() => {
  db?.close();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const add = (provider, name) => repo.createProviderConnection({ provider, authType: "apikey", name });
function change(id, allowedConnections, cookie) {
  const request = new NextRequest("http://localhost/api/keys/" + id, {
    method: "PUT",
    headers: cookie ? { cookie: "auth_token=" + cookie } : {},
    body: JSON.stringify({ allowedConnections }),
  });
  return update(request, { params: Promise.resolve({ id }) });
}

describe("connection policy", () => {
  it("preserves omitted fields, normalizes null and rejects malformed lists", () => {
    expect(validateKeyPolicy({}).value).not.toHaveProperty("allowedConnections");
    for (const value of [null, []]) expect(validateKeyPolicy({ allowedConnections: value }).value.allowedConnections).toEqual([]);
    for (const value of ["id", [4], [""], ["  "], ["a", "a"], Array.from({ length: 201 }, (_, i) => String(i))]) {
      expect(validateKeyPolicy({ allowedConnections: value }).error).toBeTruthy();
    }
  });

  it("requires credentialed admin, rejects unknown IDs atomically, audits only count and omits pins from summary", async () => {
    const key = await repo.createApiKey("policy", "test");
    const { id } = await add("codex", "policy");
    await repo.updateSettings({ requireLogin: false });
    expect((await change(key.id, [id], null)).status).toBe(401);
    expect((await change(key.id, [id], viewer)).status).toBe(403);
    expect((await change(key.id, [id], admin)).status).toBe(200);
    expect((await change(key.id, [id, "unknown"], admin)).status).toBe(400);
    expect((await repo.getPinnedKeysByConnection()).get(id)).toEqual([{ id: key.id, name: "policy" }]);
    const keys = async view => (await (await list(new Request("http://localhost/api/keys" + view))).json()).keys;
    expect((await keys("")).find(row => row.id === key.id).allowedConnections).toEqual([id]);
    const summary = (await keys("?view=summary")).find(row => row.id === key.id);
    expect(summary).not.toHaveProperty("allowedConnections");
    expect(summary).not.toHaveProperty("connectionProviders");
    const entries = await repo.listAuditEntries({ action: "key.connections", page: 1, pageSize: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorRole: "admin", target: key.id });
    expect(JSON.parse(entries[0].detail)).toEqual({ fields: ["allowedConnections"], count: 1 });
    expect((await change(key.id, null, admin)).status).toBe(200);
    expect((await repo.getPinnedKeysByConnection()).has(id)).toBe(false);
  });

  it("lists only linked key IDs and names for admins; viewers get counts by provider only", async () => {
    const { GET: providers } = await import("@/app/api/providers/route.js");
    const { GET: summary } = await import("@/app/api/providers/summary/route.js");
    const { proxy } = await import("@/dashboardGuard");
    const request = (path, token) => new NextRequest("http://localhost/api/providers" + path, {
      headers: { cookie: "auth_token=" + token },
    });
    const first = await add("openai", "linked");
    const second = await add("openai", "unlinked");
    const create = name => repo.createApiKey(name, "test", { allowedConnections: [first.id] });
    const alpha = await create("Alpha");
    const beta = await create("Beta");
    const response = await providers(request("", admin));
    expect(response.status).toBe(200);
    const { connections } = await response.json();
    expect(connections.find(row => row.id === first.id)).toMatchObject({ pinnedKeyCount: 2 });
    expect(connections.find(row => row.id === first.id).pinnedKeys).toEqual([
      { id: alpha.id, name: "Alpha" },
      { id: beta.id, name: "Beta" },
    ]);
    expect(connections.find(row => row.id === second.id)).toMatchObject({ pinnedKeys: [], pinnedKeyCount: 0 });
    for (const key of [alpha, beta]) expect(JSON.stringify(connections)).not.toContain(key.key);

    const denied = await providers(request("", viewer));
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("connections");
    const viewerRequest = request("/summary", viewer);
    expect((await proxy(viewerRequest)).status).toBe(200);
    const body = await (await summary(viewerRequest)).json();
    const aggregate = body.providers.find(row => row.provider === "openai");
    expect(aggregate).toBeDefined();
    for (const field of ["pinnedKeys", "pinnedKeyCount", "key"]) {
      expect(aggregate).not.toHaveProperty(field);
    }
    for (const key of [alpha, beta]) {
      for (const value of [key.id, key.name, key.key]) expect(JSON.stringify(body)).not.toContain(value);
    }
  });

  it.each(["round-robin", "least-connections", "weighted"])("%s stays in scope across concurrent requests and account retries", async strategy => {
    const provider = "pool-" + strategy;
    const a = await add(provider, "A");
    const b = await add(provider, "B");
    const c = await add(provider, "C");
    const other = await add("other-" + strategy, "D");
    await repo.updateSettings({ fallbackStrategy: strategy });
    const key = await repo.createApiKey("B+C", "test", { allowedConnections: [b.id, c.id] });
    const keyA = await repo.createApiKey("A", "test", { allowedConnections: [a.id] });
    const choose = (exclude, preferred) => select(provider, exclude, "model", { preferredConnectionId: preferred });
    await Promise.all([
      withKey(key, async () => {
        const first = (await choose(null, a.id)).connectionId;
        expect([b.id, c.id]).toContain(first);
        const second = (await choose(new Set([first]))).connectionId;
        expect(new Set([first, second])).toEqual(new Set([b.id, c.id]));
        expect(await choose(new Set([first, second]))).toMatchObject({ allRateLimited: true });
        expect((await select(other.provider)).connectionId).toBe(other.id);
      }),
      withKey(keyA, async () => expect((await choose(null, c.id)).connectionId).toBe(a.id)),
    ]);
    expect((await choose(null, a.id)).connectionId).toBe(a.id);
    const unrestricted = await repo.createApiKey("all", "test", { allowedConnections: [] });
    expect((await withKey(unrestricted, () => choose(null, c.id))).connectionId).toBe(c.id);
  });

  it("keeps a deleted provider scoped after JSON export/import and reports only allowed cooldowns", async () => {
    const provider = "deleted-pool";
    const other = await add(provider, "available");
    const allowed = await add(provider, "selected");
    const key = await repo.createApiKey("pinned", "test", { allowedConnections: [allowed.id] });
    const pick = () => withKey(key, () => select(provider, null, "model"));
    const until = new Date(Date.now() + 60000).toISOString();
    await repo.updateProviderConnection(allowed.id, { rateLimitedUntil: until });
    expect(await pick()).toMatchObject({ allRateLimited: true, retryAfter: until });
    await repo.deleteProviderConnection(allowed.id);
    expect(await pick()).toMatchObject({ allRateLimited: true });
    const exported = await repo.exportDb();
    await repo.importDb(exported);
    expect((await repo.getApiKeyById(key.id)).allowedConnections).toEqual([allowed.id]);
    expect(await pick()).toMatchObject({ allRateLimited: true });
    expect((await select(provider)).connectionId).toBe(other.id);
    // Import invalidates all dashboard sessions.
    expect((await change(key.id, [], admin)).status).toBe(401);
    const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession");
    const newAdmin = await createDashboardAuthToken({ role: "admin" });
    expect((await change(key.id, [], newAdmin)).status).toBe(200);
    expect((await pick()).connectionId).toBe(other.id);
  });
});
