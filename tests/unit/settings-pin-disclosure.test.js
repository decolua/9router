import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

// DF-9ROUTER-38 — REQUIRE_API_KEY env pin disclosure.
//
// Ground truth from the dogfood: .env.example ships REQUIRE_API_KEY=false and
// settingsRepo.getSettings() re-pins the env value AFTER the DB merge on every
// read, so a UI PATCH commits the user's intent to the settings row but the
// next read silently reflects the env pin again — and nothing in the GET/PATCH
// response ever told the UI (or the user) that the value was pinned.
//
// These tests pin the split the fix must disclose:
//   * the DB row keeps the user's intent (persist),
//   * responses reflect the env pin (effective value),
//   * responses expose requireApiKeyPinnedBy ("REQUIRE_API_KEY" or null).
//
// Route-level cases drive the REAL src/app/api/settings/route.js handlers
// through the web Request → Response contract (same shape as
// tests/federation/api-key-http-auth-chain.test.js) with no mocks of
// validateApiKey or the settings repo.

const THIS_FILE_LABEL = "settings-pin-disclosure";

// Everything this file pins or must not inherit: DATA_DIR must point at a
// private temp dir (the driver reads it at module load), REQUIRE_API_KEY is
// the subject under test, and the federation/auth vars are cleared so a real
// deployment's env cannot leak a pin into the env-unset cases.
const ENV_KEYS = [
  "DATA_DIR",
  "REQUIRE_API_KEY",
  "NINEROUTER_PEER_TOKEN",
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_TOKEN",
  "MACHINE_ID_SALT",
];

let tempDir;
let savedEnv = {};
let settingsRoute; // the REAL route module
let settingsRepo;
let driver;

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-${THIS_FILE_LABEL}-`));
  process.env.DATA_DIR = tempDir;

  // driver.js caches the adapter on global; paths.js/dataDir.mjs read DATA_DIR
  // at module load, so the cache must be dropped and the modules re-imported
  // after the env is pinned (same dance as api-key-http-auth-chain.test.js).
  delete global._dbAdapter;
  vi.resetModules();

  settingsRoute = await import("../../src/app/api/settings/route.js");
  settingsRepo = await import("../../src/lib/db/repos/settingsRepo.js");
  driver = await import("../../src/lib/db/driver.js");
}, 60000);

afterAll(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {
    /* noop */
  }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// Fresh settings row per test so PATCH leftovers cannot contaminate the next case.
beforeEach(async () => {
  delete process.env.REQUIRE_API_KEY;
  const db = await driver.getAdapter();
  db.run(`DELETE FROM settings WHERE id = 1`);
});

afterEach(() => {
  delete process.env.REQUIRE_API_KEY;
});

// A plain Request, exactly as a dashboard client builds one.
function patchRequest(body) {
  return new Request("http://9router.test/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("settingsRepo.requireApiKeyPinnedBy (pin disclosure helper)", () => {
  it("returns REQUIRE_API_KEY when env REQUIRE_API_KEY is exactly 'true'", () => {
    process.env.REQUIRE_API_KEY = "true";
    expect(settingsRepo.requireApiKeyPinnedBy()).toBe("REQUIRE_API_KEY");
  });

  it("returns REQUIRE_API_KEY when env REQUIRE_API_KEY is exactly 'false'", () => {
    process.env.REQUIRE_API_KEY = "false";
    expect(settingsRepo.requireApiKeyPinnedBy()).toBe("REQUIRE_API_KEY");
  });

  it("returns null when the env var is unset", () => {
    delete process.env.REQUIRE_API_KEY;
    expect(settingsRepo.requireApiKeyPinnedBy()).toBeNull();
  });

  it("returns null for values other than exact lowercase 'true'/'false'", () => {
    process.env.REQUIRE_API_KEY = "True";
    expect(settingsRepo.requireApiKeyPinnedBy()).toBeNull();
    process.env.REQUIRE_API_KEY = "1";
    expect(settingsRepo.requireApiKeyPinnedBy()).toBeNull();
    process.env.REQUIRE_API_KEY = "";
    expect(settingsRepo.requireApiKeyPinnedBy()).toBeNull();
  });
});

describe("persist-vs-response split with REQUIRE_API_KEY=false pinned", () => {
  beforeEach(() => {
    process.env.REQUIRE_API_KEY = "false";
  });

  it("updateSettings persists the user's intent (true) to the DB while responses stay false", async () => {
    const merged = await settingsRepo.updateSettings({ requireApiKey: true });

    // Response/merged view reflects the env pin...
    expect(merged.requireApiKey).toBe(false);
    // ...and the next read is re-pinned too...
    expect((await settingsRepo.getSettings()).requireApiKey).toBe(false);
    // ...but the stored DB row kept the user's intent.
    const stored = await settingsRepo.exportSettings();
    expect(stored.requireApiKey).toBe(true);
  });

  it("getSettings response stays false after a PATCH true — the pin survives reads", async () => {
    await settingsRepo.updateSettings({ requireApiKey: true });
    const settings = await settingsRepo.getSettings();
    expect(settings.requireApiKey).toBe(false);
  });
});

describe("repo path with env unset (normal path intact)", () => {
  it("PATCH true persists and GET returns true; pin helper is null", async () => {
    delete process.env.REQUIRE_API_KEY;
    expect(settingsRepo.requireApiKeyPinnedBy()).toBeNull();

    await settingsRepo.updateSettings({ requireApiKey: true });
    expect((await settingsRepo.getSettings()).requireApiKey).toBe(true);
    const stored = await settingsRepo.exportSettings();
    expect(stored.requireApiKey).toBe(true);
  });
});

describe("real GET /api/settings route exposes the pin flag", () => {
  it("returns requireApiKeyPinnedBy=REQUIRE_API_KEY when env-pinned", async () => {
    process.env.REQUIRE_API_KEY = "false";
    const res = await settingsRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requireApiKeyPinnedBy).toBe("REQUIRE_API_KEY");
    expect(body.requireApiKey).toBe(false);
  });

  it("returns requireApiKeyPinnedBy=null when not pinned (additive, harmless)", async () => {
    delete process.env.REQUIRE_API_KEY;
    const res = await settingsRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requireApiKeyPinnedBy).toBeNull();
  });
});

describe("real PATCH /api/settings route exposes the pin flag and keeps persist-vs-response split", () => {
  it("env pinned false: PATCH {requireApiKey:true} responds 200 with the pin reflected and flagged", async () => {
    process.env.REQUIRE_API_KEY = "false";

    const res = await settingsRoute.PATCH(patchRequest({ requireApiKey: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requireApiKeyPinnedBy).toBe("REQUIRE_API_KEY");
    // Response reflects the env pin, NOT the requested true.
    expect(body.requireApiKey).toBe(false);

    // Next GET agrees (still pinned)...
    const getRes = await settingsRoute.GET();
    const getBody = await getRes.json();
    expect(getBody.requireApiKey).toBe(false);
    expect(getBody.requireApiKeyPinnedBy).toBe("REQUIRE_API_KEY");

    // ...while the stored DB row persisted the user's intent.
    const stored = await settingsRepo.exportSettings();
    expect(stored.requireApiKey).toBe(true);
  });

  it("env unset: PATCH {requireApiKey:true} → response true, GET true, pin flag null", async () => {
    delete process.env.REQUIRE_API_KEY;

    const res = await settingsRoute.PATCH(patchRequest({ requireApiKey: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requireApiKeyPinnedBy).toBeNull();
    expect(body.requireApiKey).toBe(true);

    const getRes = await settingsRoute.GET();
    const getBody = await getRes.json();
    expect(getBody.requireApiKey).toBe(true);
    expect(getBody.requireApiKeyPinnedBy).toBeNull();

    const stored = await settingsRepo.exportSettings();
    expect(stored.requireApiKey).toBe(true);
  });
});
