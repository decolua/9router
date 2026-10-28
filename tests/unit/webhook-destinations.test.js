/**
 * RED tests for operational webhook destination persistence (task 2).
 *
 * Contract under test: src/lib/db/repos/webhooksRepo.js exposed through
 * src/lib/db/index.js and src/lib/localDb.js. No product implementation exists
 * yet, so collection/assertion failures are expected until GREEN.
 *
 * Fixture isolation: every test gets a fresh temp DATA_DIR and a reset adapter
 * singleton. No host/container test execution here — the parent runs the
 * approved Docker runner.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

const GENERIC_URL = "https://hooks.example.com/private/path?tenant=acme";
const RAW_SECRET = "super-secret-signing-value";
const RAW_HEADER_VALUE = "Bearer header-secret-value";

const genericInput = (overrides = {}) => ({
  name: "Ops generic",
  kind: "generic",
  url: GENERIC_URL,
  enabled: true,
  events: ["request.failed"],
  allowPrivateNetwork: false,
  cooldownSeconds: 300,
  ...overrides,
});

const codesOf = (result) => (result.ok ? [] : result.errors.map((entry) => entry.code));

const expectOk = (result) => {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
};

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-webhook-dest-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("webhook destination schema and migration", () => {
  it("fresh DB creates webhookDestinations and stamps the latest migration", async () => {
    const { SCHEMA_VERSION } = await import("@/lib/db/schema.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();

    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
    expect(latestVersion()).toBeGreaterThanOrEqual(3);

    const tables = adapter.all(`SELECT name FROM sqlite_master WHERE type='table'`)
      .map((row) => row.name);
    expect(tables).toContain("webhookDestinations");

    const columns = adapter.all("PRAGMA table_info(webhookDestinations)")
      .map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      "id", "revision", "data", "enabled", "createdAt", "updatedAt",
    ]));

    const stamped = adapter.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(stamped.value, 10)).toBe(latestVersion());
  });

  it("migrates an old DB forward without losing existing data", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const first = await getAdapter();
    await db.updateSettings({ legacyMarker: "keep-me" });
    first.exec("DROP TABLE IF EXISTS webhookDestinations");
    first.run(`UPDATE _meta SET value = '2' WHERE key = 'schemaVersion'`);
    first.close?.();

    delete global._dbAdapter;
    vi.resetModules();

    const fresh = await import("@/lib/db/index.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { getAdapter: getFreshAdapter } = await import("@/lib/db/driver.js");
    await fresh.initDb();
    const second = await getFreshAdapter();

    const settings = await fresh.getSettings();
    expect(settings.legacyMarker).toBe("keep-me");
    const tables = second.all(`SELECT name FROM sqlite_master WHERE type='table'`)
      .map((row) => row.name);
    expect(tables).toContain("webhookDestinations");
    const stamped = second.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(stamped.value, 10)).toBe(latestVersion());
  });

  it("exports the persistence API from both public barrels", async () => {
    const localDb = await import("@/lib/localDb.js");
    const names = [
      "listWebhookDestinations",
      "getWebhookDestinationById",
      "getWebhookDestinationRawById",
      "exportWebhookDestinationsRaw",
      "createWebhookDestination",
      "updateWebhookDestination",
      "deleteWebhookDestination",
    ];
    for (const name of names) {
      expect(typeof db[name], `db/index.js export ${name}`).toBe("function");
      expect(typeof localDb[name], `localDb.js export ${name}`).toBe("function");
    }
  });
});

describe("webhook destination create and redacted reads", () => {
  it("creates a generic destination and returns a safe DTO by construction", async () => {
    const result = expectOk(await db.createWebhookDestination(genericInput({
      signingSecret: RAW_SECRET,
      headers: { Authorization: RAW_HEADER_VALUE, "X-Tenant": "acme" },
    })));

    expect(result.revision).toBe(1);
    expect(result.destination.id).toBeTruthy();
    expect(result.destination.revision).toBe(1);
    expect(result.destination.url).toEqual({ scheme: "https", host: "hooks.example.com" });
    expect(result.destination.hasSigningSecret).toBe(true);
    expect(result.destination.headerCount).toBe(2);
    expect(result.destination).not.toHaveProperty("signingSecret");
    expect(result.destination).not.toHaveProperty("headers");
  });

  it("generates distinct 32-byte-grade generic secrets and preserves explicit ones", async () => {
    const first = expectOk(await db.createWebhookDestination(genericInput({ name: "one" })));
    const second = expectOk(await db.createWebhookDestination(genericInput({ name: "two" })));
    const rawFirst = await db.getWebhookDestinationRawById(first.destination.id);
    const rawSecond = await db.getWebhookDestinationRawById(second.destination.id);

    expect(typeof rawFirst.signingSecret).toBe("string");
    expect(rawFirst.signingSecret.length).toBeGreaterThanOrEqual(32);
    expect(rawFirst.signingSecret).not.toBe(rawSecond.signingSecret);

    const explicit = expectOk(await db.createWebhookDestination(genericInput({
      name: "explicit", signingSecret: "pinned-secret-value",
    })));
    const rawExplicit = await db.getWebhookDestinationRawById(explicit.destination.id);
    expect(rawExplicit.signingSecret).toBe("pinned-secret-value");
  });

  it("does not generate a signing secret for non-generic kinds", async () => {
    const result = expectOk(await db.createWebhookDestination({
      name: "Discord ops",
      kind: "discord",
      url: "https://discord.com/api/webhooks/1234567890/token-value",
      events: ["request.failed"],
    }));
    const raw = await db.getWebhookDestinationRawById(result.destination.id);

    expect(raw.signingSecret).toBeFalsy();
    expect(result.destination.hasSigningSecret).toBe(false);
  });

  it("never leaks URL path/query, signing secret or header values through reads", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({
      name: "Redacted",
      signingSecret: RAW_SECRET,
      headers: { Authorization: RAW_HEADER_VALUE },
    })));

    const listed = await db.listWebhookDestinations();
    const fetched = await db.getWebhookDestinationById(created.destination.id);
    const serialized = JSON.stringify([listed, fetched]);

    expect(serialized).not.toContain(RAW_SECRET);
    expect(serialized).not.toContain(RAW_HEADER_VALUE);
    expect(serialized).not.toContain("/private/path");
    expect(serialized).not.toContain("tenant=acme");
    expect(listed).toHaveLength(1);
    expect(fetched.url).toEqual({ scheme: "https", host: "hooks.example.com" });
  });

  it("exposes full credentials only through the internal raw/export path", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({
      signingSecret: RAW_SECRET,
      headers: { Authorization: RAW_HEADER_VALUE },
    })));

    const raw = await db.getWebhookDestinationRawById(created.destination.id);
    const exported = await db.exportWebhookDestinationsRaw();

    expect(raw.url).toBe(GENERIC_URL);
    expect(raw.signingSecret).toBe(RAW_SECRET);
    expect(raw.headers).toEqual({ Authorization: RAW_HEADER_VALUE });
    expect(exported).toHaveLength(1);
    expect(exported[0]).toEqual(expect.objectContaining({
      url: GENERIC_URL, signingSecret: RAW_SECRET,
    }));
  });

  it("rejects invalid or internal input without persisting anything", async () => {
    const internal = await db.createWebhookDestination(genericInput({ deliveryKind: "test" }));
    const oversized = await db.createWebhookDestination(genericInput({ name: "x".repeat(81) }));
    const badKind = await db.createWebhookDestination(genericInput({ kind: "email" }));

    expect(codesOf(internal)).toContain("internal_field");
    expect(codesOf(oversized)).toContain("name_too_long");
    expect(codesOf(badKind)).toContain("invalid_kind");
    expect(await db.listWebhookDestinations()).toHaveLength(0);
  });
});

describe("webhook destination patch semantics", () => {
  it("omitting secrets, headers and URL preserves them and increments revision", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({
      name: "Before",
      signingSecret: RAW_SECRET,
      headers: { Authorization: RAW_HEADER_VALUE, "X-Tenant": "acme" },
    })));

    const updated = expectOk(await db.updateWebhookDestination(
      created.destination.id,
      { name: "After" },
      { expectedRevision: 1 },
    ));
    const raw = await db.getWebhookDestinationRawById(created.destination.id);

    expect(updated.revision).toBe(2);
    expect(raw.name).toBe("After");
    expect(raw.url).toBe(GENERIC_URL);
    expect(raw.signingSecret).toBe(RAW_SECRET);
    expect(raw.headers).toEqual({ Authorization: RAW_HEADER_VALUE, "X-Tenant": "acme" });
    expect(updated.destination.hasSigningSecret).toBe(true);
    expect(updated.destination.headerCount).toBe(2);
  });

  it("clearSigningSecret regenerates for generic and removes for other kinds", async () => {
    const generic = expectOk(await db.createWebhookDestination(genericInput({ name: "regen" })));
    const before = await db.getWebhookDestinationRawById(generic.destination.id);
    expectOk(await db.updateWebhookDestination(
      generic.destination.id, { clearSigningSecret: true }, { expectedRevision: 1 },
    ));
    const after = await db.getWebhookDestinationRawById(generic.destination.id);
    expect(after.signingSecret).toBeTruthy();
    expect(after.signingSecret).not.toBe(before.signingSecret);

    const discord = expectOk(await db.createWebhookDestination({
      name: "Discord clear",
      kind: "discord",
      url: "https://discord.com/api/webhooks/1234567890/token-value",
      events: ["request.failed"],
      signingSecret: "discord-explicit-secret",
    }));
    expectOk(await db.updateWebhookDestination(
      discord.destination.id, { clearSigningSecret: true }, { expectedRevision: 1 },
    ));
    const cleared = await db.getWebhookDestinationRawById(discord.destination.id);
    expect(cleared.signingSecret).toBeFalsy();
  });

  it("clearHeaders removes stored auth headers", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({
      headers: { Authorization: RAW_HEADER_VALUE },
    })));
    expectOk(await db.updateWebhookDestination(
      created.destination.id, { clearHeaders: true }, { expectedRevision: 1 },
    ));
    const raw = await db.getWebhookDestinationRawById(created.destination.id);
    expect(raw.headers).toEqual({});
  });

  it("validates the fully merged patch: kind change with existing headers rolls back", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({
      headers: { Authorization: RAW_HEADER_VALUE },
    })));
    const rejected = await db.updateWebhookDestination(
      created.destination.id,
      { kind: "discord" },
      { expectedRevision: 1 },
    );
    const raw = await db.getWebhookDestinationRawById(created.destination.id);

    expect(codesOf(rejected)).toContain("headers_not_supported");
    expect(raw.kind).toBe("generic");
    expect(raw.revision).toBe(1);
    expect(raw.headers).toEqual({ Authorization: RAW_HEADER_VALUE });
  });

  it("validates the fully merged patch: HTTP downgrade without private opt-in rolls back", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({
      url: "http://192.168.1.10:8080/hook",
      allowPrivateNetwork: true,
    })));
    const rejected = await db.updateWebhookDestination(
      created.destination.id,
      { allowPrivateNetwork: false },
      { expectedRevision: 1 },
    );
    const raw = await db.getWebhookDestinationRawById(created.destination.id);

    expect(codesOf(rejected)).toContain("http_requires_private_opt_in");
    expect(raw.allowPrivateNetwork).toBe(true);
    expect(raw.url).toBe("http://192.168.1.10:8080/hook");
    expect(raw.revision).toBe(1);
  });

  it("rejects invalid edits without bumping revision, and enforces expected revision", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput({ name: "first" })));
    const invalid = await db.updateWebhookDestination(
      created.destination.id,
      { name: "x".repeat(81) },
      { expectedRevision: 1 },
    );
    expect(codesOf(invalid)).toContain("name_too_long");
    expect((await db.getWebhookDestinationRawById(created.destination.id)).revision).toBe(1);

    const updated = expectOk(await db.updateWebhookDestination(
      created.destination.id, { name: "second" }, { expectedRevision: 1 },
    ));
    expect(updated.revision).toBe(2);

    const stale = await db.updateWebhookDestination(
      created.destination.id, { name: "stale" }, { expectedRevision: 1 },
    );
    expect(codesOf(stale)).toContain("revision_conflict");
    expect((await db.getWebhookDestinationRawById(created.destination.id)).name).toBe("second");

    const missing = await db.updateWebhookDestination(
      "missing-id", { name: "nope" }, { expectedRevision: 1 },
    );
    expect(codesOf(missing)).toContain("not_found");
  });
});

describe("webhook destination capacity", () => {
  it("accepts 20 destinations and rejects the 21st atomically", async () => {
    for (let i = 0; i < 20; i += 1) {
      expectOk(await db.createWebhookDestination(genericInput({ name: `dest-${i}` })));
    }
    const overflow = await db.createWebhookDestination(genericInput({ name: "dest-20" }));

    expect(codesOf(overflow)).toContain("destination_limit");
    expect(await db.listWebhookDestinations()).toHaveLength(20);
  });

  it("keeps the 20-row cap under concurrent creates", async () => {
    const attempts = Array.from({ length: 21 }, (_, i) =>
      db.createWebhookDestination(genericInput({ name: `parallel-${i}` })));
    const results = await Promise.all(attempts);
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);

    expect(successes).toHaveLength(20);
    expect(failures).toHaveLength(1);
    expect(codesOf(failures[0])).toContain("destination_limit");
    expect(await db.listWebhookDestinations()).toHaveLength(20);
  });
});

describe("webhook destination delete", () => {
  it("requires the current revision and removes the row", async () => {
    const created = expectOk(await db.createWebhookDestination(genericInput()));

    const stale = await db.deleteWebhookDestination(
      created.destination.id, { expectedRevision: 0 },
    );
    expect(codesOf(stale)).toContain("revision_conflict");
    expect(await db.getWebhookDestinationById(created.destination.id)).not.toBeNull();

    expectOk(await db.deleteWebhookDestination(
      created.destination.id, { expectedRevision: 1 },
    ));
    expect(await db.getWebhookDestinationById(created.destination.id)).toBeNull();
    expect(await db.getWebhookDestinationRawById(created.destination.id)).toBeNull();
    expect(await db.listWebhookDestinations()).toHaveLength(0);
  });

  it("returns not_found for a missing destination", async () => {
    const result = await db.deleteWebhookDestination("missing-id", { expectedRevision: 1 });
    expect(codesOf(result)).toContain("not_found");
  });
});
