// FED-001 — federation config module tests.
// Env is read at import time (mode) / call time (knobs), so each test
// re-imports the module with a controlled process.env and restores after.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_TOKEN",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_HEARTBEAT_INTERVAL_MS",
  "FEDERATION_OUTAGE_THRESHOLD_MS",
  "FEDERATION_QUEUE_MAX",
  "FEDERATION_REPLAY_BATCH_SIZE",
  "FEDERATION_REDACT_FIELDS",
];

const savedEnv = {};

beforeEach(() => {
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function loadConfig() {
  return import("@/lib/federation/config.js");
}

describe("FEDERATION_MODE parsing", () => {
  it("defaults to standalone when unset", async () => {
    const cfg = await loadConfig();
    expect(cfg.getMode()).toBe("standalone");
    expect(cfg.isStandalone()).toBe(true);
    expect(cfg.isEdge()).toBe(false);
    expect(cfg.isCentral()).toBe(false);
  });

  it("defaults to standalone for empty string", async () => {
    process.env.FEDERATION_MODE = "";
    const cfg = await loadConfig();
    expect(cfg.getMode()).toBe("standalone");
    expect(cfg.isStandalone()).toBe(true);
  });

  it("parses 'central'", async () => {
    process.env.FEDERATION_MODE = "central";
    const cfg = await loadConfig();
    expect(cfg.getMode()).toBe("central");
    expect(cfg.isCentral()).toBe(true);
    expect(cfg.isStandalone()).toBe(false);
    expect(cfg.isEdge()).toBe(false);
  });

  it("parses 'edge'", async () => {
    process.env.FEDERATION_MODE = "edge";
    const cfg = await loadConfig();
    expect(cfg.getMode()).toBe("edge");
    expect(cfg.isEdge()).toBe(true);
    expect(cfg.isStandalone()).toBe(false);
    expect(cfg.isCentral()).toBe(false);
  });

  it("is case/whitespace tolerant", async () => {
    process.env.FEDERATION_MODE = "  EDGE ";
    const cfg = await loadConfig();
    expect(cfg.isEdge()).toBe(true);
  });

  it("throws on unknown mode (no silent fallback)", async () => {
    process.env.FEDERATION_MODE = "bogus";
    await expect(loadConfig()).rejects.toThrow(/FEDERATION_MODE/);
  });

  it("exports MODES frozen", async () => {
    const cfg = await loadConfig();
    expect(cfg.MODES).toEqual(["standalone", "central", "edge"]);
    expect(Object.isFrozen(cfg.MODES)).toBe(true);
  });
});

describe("env knob defaults (spec §4)", () => {
  it("returns spec defaults when unset", async () => {
    const cfg = await loadConfig();
    expect(cfg.getCentralUrl()).toBeNull();
    expect(cfg.getToken()).toBeNull();
    expect(cfg.getSyncIntervalMs()).toBe(5000);
    expect(cfg.getHeartbeatIntervalMs()).toBe(2000);
    expect(cfg.getOutageThresholdMs()).toBe(15000);
    expect(cfg.getQueueMax()).toBe(10000);
    expect(cfg.getReplayBatchSize()).toBe(50);
    expect(cfg.getRedactFields()).toEqual([]);
  });

  it("reads env overrides", async () => {
    process.env.FEDERATION_CENTRAL_URL = "https://central.example";
    process.env.FEDERATION_TOKEN = "s3cret";
    process.env.FEDERATION_SYNC_INTERVAL_MS = "1234";
    process.env.FEDERATION_HEARTBEAT_INTERVAL_MS = "99";
    process.env.FEDERATION_OUTAGE_THRESHOLD_MS = "30000";
    process.env.FEDERATION_QUEUE_MAX = "5";
    process.env.FEDERATION_REPLAY_BATCH_SIZE = "7";
    process.env.FEDERATION_REDACT_FIELDS = "a.b, c.d ,e";
    const cfg = await loadConfig();
    expect(cfg.getCentralUrl()).toBe("https://central.example");
    expect(cfg.getToken()).toBe("s3cret");
    expect(cfg.getSyncIntervalMs()).toBe(1234);
    expect(cfg.getHeartbeatIntervalMs()).toBe(99);
    expect(cfg.getOutageThresholdMs()).toBe(30000);
    expect(cfg.getQueueMax()).toBe(5);
    expect(cfg.getReplayBatchSize()).toBe(7);
    expect(cfg.getRedactFields()).toEqual(["a.b", "c.d", "e"]);
  });

  it("treats empty-string knobs as unset (defaults apply)", async () => {
    process.env.FEDERATION_SYNC_INTERVAL_MS = "";
    process.env.FEDERATION_QUEUE_MAX = "";
    const cfg = await loadConfig();
    expect(cfg.getSyncIntervalMs()).toBe(5000);
    expect(cfg.getQueueMax()).toBe(10000);
  });

  it("throws on non-numeric interval values", async () => {
    process.env.FEDERATION_SYNC_INTERVAL_MS = "abc";
    const cfg = await loadConfig();
    expect(() => cfg.getSyncIntervalMs()).toThrow(/FEDERATION_SYNC_INTERVAL_MS/);
  });

  it("throws on negative values", async () => {
    process.env.FEDERATION_QUEUE_MAX = "-1";
    const cfg = await loadConfig();
    expect(() => cfg.getQueueMax()).toThrow(/FEDERATION_QUEUE_MAX/);
  });

  it("floors float values to integers", async () => {
    process.env.FEDERATION_SYNC_INTERVAL_MS = "5000.9";
    const cfg = await loadConfig();
    expect(cfg.getSyncIntervalMs()).toBe(5000);
  });
});

describe("FEDERATION_EDGE_ID", () => {
  it("defaults to node-machine-id when unset", async () => {
    const cfg = await loadConfig();
    const id = cfg.getEdgeId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("prefers FEDERATION_EDGE_ID env override", async () => {
    process.env.FEDERATION_EDGE_ID = "edge-42";
    const cfg = await loadConfig();
    expect(cfg.getEdgeId()).toBe("edge-42");
  });
});

describe("constants", () => {
  it("REPLICATE_TABLES lists the 8 logical tables incl. kv-backed aliases/pricing", async () => {
    const { REPLICATE_TABLES, REPLICATE_TABLES_PHYSICAL, STATES, STATES_LIST, ENV_DEFAULTS } =
      await import("@/lib/federation/constants.js");
    expect(REPLICATE_TABLES).toEqual([
      "settings",
      "providerConnections",
      "providerNodes",
      "proxyPools",
      "apiKeys",
      "modelAliases",
      "combos",
      "pricing",
    ]);
    expect(Object.isFrozen(REPLICATE_TABLES)).toBe(true);
    expect(REPLICATE_TABLES_PHYSICAL).toEqual([
      "settings",
      "providerConnections",
      "providerNodes",
      "proxyPools",
      "apiKeys",
      "combos",
      "kv",
    ]);
    expect(STATES).toEqual({ LINKED: "linked", DEGRADED: "degraded", RECOVERING: "recovering" });
    expect(Object.isFrozen(STATES)).toBe(true);
    expect(STATES_LIST).toEqual(["linked", "degraded", "recovering"]);
    expect(ENV_DEFAULTS.MODE).toBe("standalone");
    expect(ENV_DEFAULTS.SYNC_INTERVAL_MS).toBe(5000);
  });
});
