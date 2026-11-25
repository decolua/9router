import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET = "dashboard-session-revocation-test-only";
  return { adapter: null, fail: false };
});
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}) }));
const cookieState = vi.hoisted(() => ({ store: null }));
vi.mock("next/headers", () => ({ cookies: async () => cookieState.store }));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => {
    if (state.fail) throw new Error("test database unavailable");
    return state.adapter;
  },
}));

const session = await import("../../src/lib/auth/dashboardSession.js");
const logout = await import("../../src/app/api/auth/logout/route.js");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "9router-session-test-"));
const database = path.join(directory, "test.sqlite");
let db;
function openDatabase() {
  db = new DatabaseSync(database);
  db.exec("CREATE TABLE IF NOT EXISTS kv(scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key))");
  state.adapter = {
    get: (sql, args = []) => db.prepare(sql).get(...args),
    run: (sql, args = []) => db.prepare(sql).run(...args),
    transaction: (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try { const result = fn(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
}
function cookieStore(token) {
  return { get: () => token ? { value: token } : undefined, delete: vi.fn() };
}
async function sign(claims, secret = process.env.JWT_SECRET, algorithm = "HS256") {
  return new SignJWT(claims).setProtectedHeader({ alg: algorithm })
    .setIssuedAt().setExpirationTime("24h").sign(new TextEncoder().encode(secret));
}
beforeAll(openDatabase);
beforeEach(() => { state.fail = false; db.exec("DELETE FROM kv"); });
afterAll(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("persistent dashboard session revocation", () => {
  it("gives same-second logins independent session identities", async () => {
    const first = await session.createDashboardAuthToken();
    const second = await session.createDashboardAuthToken();
    expect(first).not.toBe(second);
    expect((await session.getDashboardAuthSession(first)).jti).toBeTypeOf("string");
  });
  it.each([{}, { oidc: true, oidcSub: "test-subject" }, { saml: true, samlName: "test-user" }])(
    "revokes a copied token while preserving another login: %j", async (claims) => {
      const first = await session.createDashboardAuthToken(claims);
      const second = await session.createDashboardAuthToken(claims);
      expect(await session.verifyDashboardAuthToken(first)).toBe(true);
      const store = cookieStore(first);
      await session.clearDashboardAuthCookie(store);
      expect(store.delete).toHaveBeenCalledWith("auth_token");
      expect(await session.verifyDashboardAuthToken(first)).toBe(false);
      expect(await session.getDashboardAuthSession(first)).toBeNull();
      expect(await session.verifyDashboardAuthToken(second)).toBe(true);
    });
  it("keeps the revocation after the SQLite connection is reopened", async () => {
    const token = await session.createDashboardAuthToken();
    await session.clearDashboardAuthCookie(cookieStore(token));
    db.close(); openDatabase();
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
  });
  it("supports legacy signed sessions until their exact token is signed out", async () => {
    const token = await sign({ authenticated: true, oidc: true });
    expect(await session.verifyDashboardAuthToken(token)).toBe(true);
    await session.clearDashboardAuthCookie(cookieStore(token));
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
  });
  it("does not lose concurrent revocations or retain the raw token", async () => {
    const tokens = await Promise.all(Array.from({ length: 8 }, () => session.createDashboardAuthToken()));
    await Promise.all(tokens.map((token) => session.clearDashboardAuthCookie(cookieStore(token))));
    for (const token of tokens) expect(await session.verifyDashboardAuthToken(token)).toBe(false);
    const rows = db.prepare("SELECT * FROM kv").all();
    expect(rows).toHaveLength(8);
    for (const row of rows) expect(row.key).toMatch(/^[a-f0-9]{64}$/);
  });
  it("fails closed on storage failure and retains the browser cookie so logout can be retried", async () => {
    const token = await session.createDashboardAuthToken();
    state.fail = true;
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
    const store = cookieStore(token);
    await expect(session.clearDashboardAuthCookie(store)).rejects.toThrow();
    expect(store.delete).not.toHaveBeenCalled();
  });
  it("rejects foreign tokens, missing/false dashboard claims, and other signing algorithms", async () => {
    for (const claims of [{}, { authenticated: false }, { authenticated: "true" }]) {
      expect(await session.verifyDashboardAuthToken(await sign(claims))).toBe(false);
    }
    expect(await session.verifyDashboardAuthToken(await sign({ authenticated: true }, "foreign-secret"))).toBe(false);
    expect(await session.verifyDashboardAuthToken(await sign({ authenticated: true }, process.env.JWT_SECRET, "HS384"))).toBe(false);
  });
  it("clears an absent or invalid cookie without needing storage", async () => {
    state.fail = true;
    for (const token of [null, "invalid"]) {
      const store = cookieStore(token);
      await session.clearDashboardAuthCookie(store);
      expect(store.delete).toHaveBeenCalledWith("auth_token");
    }
  });
  it("does not evict a live revocation when many other sessions sign out", async () => {
    const token = await session.createDashboardAuthToken();
    await session.clearDashboardAuthCookie(cookieStore(token));
    for (let i = 0; i < 510; i++) {
      await session.clearDashboardAuthCookie(cookieStore(await session.createDashboardAuthToken()));
    }
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM kv").get().n).toBe(511);
  }, 20_000);
  it("prunes expired entries without touching another KV namespace", async () => {
    db.prepare("INSERT INTO kv VALUES(?,?,?)").run("revokedDashboardSessions", "expired", "1");
    db.prepare("INSERT INTO kv VALUES(?,?,?)").run("modelAliases", "keep", '"unchanged"');
    await session.clearDashboardAuthCookie(cookieStore(await session.createDashboardAuthToken()));
    expect(db.prepare("SELECT 1 FROM kv WHERE key='expired'").get()).toBeUndefined();
    expect(db.prepare("SELECT value FROM kv WHERE key='keep'").get().value).toBe('"unchanged"');
  });
  it("the actual logout route awaits durable revocation", async () => {
    const token = await session.createDashboardAuthToken();
    cookieState.store = cookieStore(token);
    const response = await logout.POST();
    expect(response.status).toBe(200);
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
    expect(cookieState.store.delete.mock.calls.map(([name]) => name)).toEqual([
      "auth_token", "oidc_state", "oidc_nonce", "oidc_code_verifier",
    ]);
  });
  it("the actual logout route returns a safe retryable error on write failure", async () => {
    cookieState.store = cookieStore(await session.createDashboardAuthToken());
    state.fail = true;
    const response = await logout.POST();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Session could not be ended. Please retry logout." });
    expect(cookieState.store.delete).not.toHaveBeenCalled();
  });
  it("flushes sql.js before success, without relying on close or its debounce timer", async () => {
    const { createSqlJsAdapter } = await import("../../src/lib/db/adapters/sqljsAdapter.js");
    const file = path.join(directory, "fallback.sqlite");
    const previous = state.adapter;
    const writer = await createSqlJsAdapter(file);
    let reader;
    try {
      writer.exec("CREATE TABLE kv(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,key))");
      state.adapter = writer;
      const token = await session.createDashboardAuthToken();
      await session.clearDashboardAuthCookie(cookieStore(token));
      // Open the file while writer is still open and the 100ms timer has not run.
      reader = await createSqlJsAdapter(file);
      state.adapter = reader;
      expect(await session.verifyDashboardAuthToken(token)).toBe(false);
      expect(await session.verifyDashboardAuthToken(await session.createDashboardAuthToken())).toBe(true);
    } finally {
      reader?.close(); writer.close(); state.adapter = previous;
    }
  });
});
