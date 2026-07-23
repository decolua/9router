import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const originalDbAdapter = global._dbAdapter;
let tempDir;
let db;
let patchProviderStrategy;
let patchSettings;

function jsonPatch(url, body) {
  return new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callProviderPatch(providerId, body) {
  return patchProviderStrategy(
    jsonPatch(
      `http://localhost/api/settings/provider-strategies/${encodeURIComponent(providerId)}`,
      body,
    ),
    { params: Promise.resolve({ providerId }) },
  );
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-settings-"));
  process.env.DATA_DIR = tempDir;
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  vi.resetModules();

  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ PATCH: patchProviderStrategy } = await import(
    "../../src/app/api/settings/provider-strategies/[providerId]/route.js"
  ));
  ({ PATCH: patchSettings } = await import("../../src/app/api/settings/route.js"));
});

beforeEach(async () => {
  await db.updateSettings({
    providerStrategies: {
      codex: {
        fallbackStrategy: "round-robin",
        stickyRoundRobinLimit: 3,
        customFutureKey: "preserve-me",
      },
      github: {
        customSiblingKey: "also-preserve-me",
      },
    },
  });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  global._dbAdapter = originalDbAdapter;
});

describe("provider-scoped strategy settings", () => {
  it("atomically merges one provider without losing siblings or unknown keys", async () => {
    const admission = {
      enabled: true,
      maxInFlightPerAccount: 4,
      maxQueueSize: 250,
      queueTimeoutMs: 45000,
    };

    const strategy = await db.updateProviderStrategy("codex", { admission });
    const settings = await db.getSettings();

    expect(strategy).toEqual({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
      customFutureKey: "preserve-me",
      admission,
    });
    expect(settings.providerStrategies.github).toEqual({
      customSiblingKey: "also-preserve-me",
    });
  });

  it("does not lose concurrent updates to different provider IDs", async () => {
    await Promise.all([
      db.updateProviderStrategy("codex", {
        admission: {
          enabled: true,
          maxInFlightPerAccount: 2,
          maxQueueSize: 100,
          queueTimeoutMs: 10000,
        },
      }),
      db.updateProviderStrategy("github", {
        fallbackStrategy: "fill-first",
      }),
    ]);

    const settings = await db.getSettings();
    expect(settings.providerStrategies.codex.admission.maxInFlightPerAccount).toBe(2);
    expect(settings.providerStrategies.codex.customFutureKey).toBe("preserve-me");
    expect(settings.providerStrategies.github).toEqual({
      customSiblingKey: "also-preserve-me",
      fallbackStrategy: "fill-first",
    });
  });

  it("supports explicit field removal while preserving the rest of the override", async () => {
    const strategy = await db.updateProviderStrategy("codex", {
      fallbackStrategy: null,
    });

    expect(strategy).toEqual({
      stickyRoundRobinLimit: 3,
      customFutureKey: "preserve-me",
    });
  });

  it("returns the merged override from a valid provider-scoped patch", async () => {
    const admission = {
      enabled: true,
      maxInFlightPerAccount: 5,
      maxQueueSize: 300,
      queueTimeoutMs: 60000,
    };
    const response = await callProviderPatch("codex", { admission });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providerId: "codex",
      strategy: {
        fallbackStrategy: "round-robin",
        stickyRoundRobinLimit: 3,
        customFutureKey: "preserve-me",
        admission,
      },
    });
  });

  it("rejects invalid admission fields before writing", async () => {
    const before = await db.getSettings();
    const response = await callProviderPatch("codex", {
      admission: {
        enabled: true,
        maxInFlightPerAccount: 0,
        maxQueueSize: 200,
        queueTimeoutMs: 30000,
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{
        field: "maxInFlightPerAccount",
        code: "out_of_range",
      }],
    });
    expect((await db.getSettings()).providerStrategies).toEqual(
      before.providerStrategies,
    );
  });

  it("rejects unrelated and protected fields on the provider-scoped route", async () => {
    const response = await callProviderPatch("codex", {
      password: "must-not-be-reachable",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{
        field: "password",
        code: "unknown_field",
      }],
    });
  });

  it("rejects unsafe provider identifiers", async () => {
    const response = await callProviderPatch("__proto__", {
      fallbackStrategy: "fill-first",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid provider ID",
    });
  });

  it("validates admission objects supplied through the general settings route", async () => {
    const before = await db.getSettings();
    const response = await patchSettings(jsonPatch(
      "http://localhost/api/settings",
      {
        providerStrategies: {
          codex: {
            admission: {
              enabled: true,
              maxInFlightPerAccount: 1.5,
              maxQueueSize: 200,
              queueTimeoutMs: 30000,
            },
          },
        },
      },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{
        field: "maxInFlightPerAccount",
        code: "invalid_integer",
      }],
    });
    expect((await db.getSettings()).providerStrategies).toEqual(
      before.providerStrategies,
    );
  });
});
