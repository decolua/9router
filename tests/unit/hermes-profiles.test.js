/**
 * Tests for Issue #1952 — Hermes multi-profile support.
 *
 * Coverage:
 *   Group 1 — Pure helpers (no DB, fully synchronous).
 *   Group 2 — DB round-trip: profile CRUD via profileStore with an isolated
 *              in-process SQLite DB (same pattern as headroom-persist.test.js).
 *   Group 3 — Migration helper: auto-populates a "default" profile from an
 *              existing on-disk config model block.
 *   Group 4 — applyProfile helpers: YAML upsert/remove + .env helpers.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  describe, it, expect, beforeAll, afterAll, vi,
} from "vitest";

// ─── Group 1: Pure helpers ────────────────────────────────────────────────────

import {
  buildProfile,
  generateProfileId,
  isLocal9RouterBaseUrl,
  looksLike9RouterConfig,
  normalizeBaseUrl,
  sanitizeProfile,
  validateProfileFields,
} from "../../src/lib/hermes/profileStore.js";

describe("Hermes profile — pure helpers", () => {
  it("generateProfileId returns a string starting with 'hp_'", () => {
    const id = generateProfileId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("hp_")).toBe(true);
  });

  it("generateProfileId produces unique values", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateProfileId()));
    expect(ids.size).toBe(20);
  });

  it("normalizeBaseUrl appends /v1 when missing", () => {
    expect(normalizeBaseUrl("http://localhost:20128")).toBe("http://localhost:20128/v1");
  });

  it("normalizeBaseUrl is idempotent when /v1 already present", () => {
    expect(normalizeBaseUrl("http://localhost:20128/v1")).toBe("http://localhost:20128/v1");
  });

  it("normalizeBaseUrl handles trailing spaces", () => {
    expect(normalizeBaseUrl("  http://localhost:20128  ")).toBe("http://localhost:20128/v1");
  });

  it("normalizeBaseUrl returns its input when falsy", () => {
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl(null)).toBe(null);
  });

  it("validateProfileFields returns no errors for a valid profile", () => {
    expect(validateProfileFields({ name: "work", baseUrl: "http://x", model: "m" })).toEqual([]);
  });

  it("validateProfileFields reports missing name", () => {
    const errs = validateProfileFields({ name: "", baseUrl: "http://x", model: "m" });
    expect(errs).toContain("name is required");
  });

  it("validateProfileFields reports missing baseUrl", () => {
    const errs = validateProfileFields({ name: "n", baseUrl: "  ", model: "m" });
    expect(errs).toContain("baseUrl is required");
  });

  it("validateProfileFields reports missing model", () => {
    const errs = validateProfileFields({ name: "n", baseUrl: "http://x", model: "" });
    expect(errs).toContain("model is required");
  });

  it("validateProfileFields reports all three errors when all fields empty", () => {
    const errs = validateProfileFields({ name: "", baseUrl: "", model: "" });
    expect(errs).toHaveLength(3);
  });

  it("buildProfile constructs a profile with normalized baseUrl and ISO timestamps", () => {
    const p = buildProfile({ name: "  test  ", baseUrl: "http://localhost:20128", model: "cc/claude-sonnet-4" });
    expect(p.name).toBe("test");
    expect(p.baseUrl).toBe("http://localhost:20128/v1");
    expect(p.model).toBe("cc/claude-sonnet-4");
    expect(p.apiKey).toBeNull();
    expect(p.id).toMatch(/^hp_/);
    expect(new Date(p.createdAt).getFullYear()).toBeGreaterThanOrEqual(2026);
    expect(p.createdAt).toBe(p.updatedAt);
  });

  it("buildProfile stores a provided apiKey", () => {
    const p = buildProfile({ name: "n", baseUrl: "http://x", model: "m", apiKey: "sk-abc" });
    expect(p.apiKey).toBe("sk-abc");
  });

  it("isLocal9RouterBaseUrl returns true for localhost URLs", () => {
    expect(isLocal9RouterBaseUrl("http://localhost:20128/v1")).toBe(true);
  });

  it("isLocal9RouterBaseUrl returns false for external URLs", () => {
    expect(isLocal9RouterBaseUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("sanitizeProfile strips apiKey and exposes hasApiKey instead", () => {
    const safe = sanitizeProfile({
      id: "p1",
      name: "default",
      baseUrl: "http://localhost:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-secret",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    });
    expect(safe.apiKey).toBeUndefined();
    expect(safe.hasApiKey).toBe(true);
  });

  it("looksLike9RouterConfig returns true for localhost URL", () => {
    expect(looksLike9RouterConfig({ base_url: "http://localhost:20128/v1", provider: "custom" })).toBe(true);
  });

  it("looksLike9RouterConfig returns true for 127.0.0.1 URL", () => {
    expect(looksLike9RouterConfig({ base_url: "http://127.0.0.1:20128/v1", provider: "custom" })).toBe(true);
  });

  it("looksLike9RouterConfig returns false for external URL", () => {
    expect(looksLike9RouterConfig({ base_url: "https://api.openai.com/v1", provider: "custom" })).toBe(false);
  });

  it("looksLike9RouterConfig returns false for non-custom providers", () => {
    expect(looksLike9RouterConfig({ base_url: "http://localhost:20128/v1", provider: "openai" })).toBe(false);
  });

  it("looksLike9RouterConfig returns false for null modelCfg", () => {
    expect(looksLike9RouterConfig(null)).toBe(false);
  });

  it("looksLike9RouterConfig returns false when base_url is absent", () => {
    expect(looksLike9RouterConfig({ provider: "custom" })).toBe(false);
  });
});

// ─── Group 2: DB round-trip ───────────────────────────────────────────────────

describe("Hermes profile — DB CRUD (isolated SQLite)", () => {
  const origDataDir = process.env.DATA_DIR;
  let tempDir;
  let db;
  let store;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hermes-profiles-"));
    process.env.DATA_DIR = tempDir;
    // Reset module registry so db/driver picks up the new DATA_DIR
    const { createRequire } = await import("node:module");
    const { vi } = await import("vitest");
    vi.resetModules();
    db = await import("../../src/lib/db/index.js");
    await db.initDb();
    // Re-import profileStore after resetModules so it uses the same db adapter
    store = await import("../../src/lib/hermes/profileStore.js");
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
  });

  it("getProfileStore returns empty store initially", async () => {
    const s = await store.getProfileStore();
    expect(s.profiles).toEqual([]);
    expect(s.activeProfileId).toBeNull();
  });

  it("createProfile persists a profile without activating it", async () => {
    const p = await store.createProfile({
      name: "default",
      baseUrl: "http://127.0.0.1:20128",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-test",
    });
    expect(p.id).toMatch(/^hp_/);
    expect(p.name).toBe("default");
    expect(p.baseUrl).toBe("http://127.0.0.1:20128/v1");

    const s = await store.getProfileStore();
    expect(s.profiles).toHaveLength(1);
    expect(s.activeProfileId).toBeNull();
  });

  it("createProfile leaves activeProfileId unset until a profile is explicitly activated", async () => {
    const p2 = await store.createProfile({
      name: "work",
      baseUrl: "http://127.0.0.1:20128",
      model: "cc/claude-opus-4",
    });

    const s1 = await store.getProfileStore();
    expect(s1.profiles).toHaveLength(2);
    expect(s1.activeProfileId).toBeNull();
    expect(p2.id).not.toBe(s1.profiles[0].id);
  });

  it("listProfiles returns all profiles and activeProfileId", async () => {
    const s = await store.listProfiles();
    expect(s.profiles).toHaveLength(2);
    expect(s.activeProfileId).toBeNull();
  });

  it("getProfileById returns the correct profile", async () => {
    const s = await store.listProfiles();
    const target = s.profiles[1];
    const found = await store.getProfileById(target.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(target.id);
    expect(found.name).toBe("work");
  });

  it("getProfileById returns null for an unknown id", async () => {
    const notFound = await store.getProfileById("hp_does_not_exist");
    expect(notFound).toBeNull();
  });

  it("updateProfile renames and normalizes baseUrl", async () => {
    const s = await store.listProfiles();
    const target = s.profiles[0];
    const updated = await store.updateProfile(target.id, {
      name: "renamed",
      baseUrl: "http://127.0.0.1:20128",
      model: "cc/claude-sonnet-4",
    });
    expect(updated.name).toBe("renamed");
    expect(updated.baseUrl).toBe("http://127.0.0.1:20128/v1");
    expect(updated.updatedAt).not.toBe(target.updatedAt); // timestamp refreshed
  });

  it("updateProfile returns null for unknown id", async () => {
    const result = await store.updateProfile("hp_does_not_exist", { name: "x", baseUrl: "http://y", model: "z" });
    expect(result).toBeNull();
  });

  it("setActiveProfileId changes the active profile in DB", async () => {
    const s = await store.listProfiles();
    const second = s.profiles[1];
    const activated = await store.setActiveProfileId(second.id);
    expect(activated.id).toBe(second.id);

    const s2 = await store.listProfiles();
    expect(s2.activeProfileId).toBe(second.id);
  });

  it("setActiveProfileId returns null for unknown id", async () => {
    const result = await store.setActiveProfileId("hp_does_not_exist");
    expect(result).toBeNull();
  });

  it("clearActiveProfileId deactivates the current profile without deleting it", async () => {
    const before = await store.listProfiles();
    expect(before.activeProfileId).not.toBeNull();

    const cleared = await store.clearActiveProfileId();
    expect(cleared.activeProfileId).toBeNull();
    expect(cleared.profiles.length).toBe(before.profiles.length);

    const after = await store.listProfiles();
    expect(after.activeProfileId).toBeNull();
    expect(after.profiles).toHaveLength(before.profiles.length);
  });

  it("deleteProfile removes the profile from the store", async () => {
    // Create a disposable profile
    const p = await store.createProfile({ name: "to-delete", baseUrl: "http://127.0.0.1:20128", model: "m" });
    const s0 = await store.listProfiles();
    const before = s0.profiles.length;

    const deleted = await store.deleteProfile(p.id);
    expect(deleted).toBe(true);

    const s1 = await store.listProfiles();
    expect(s1.profiles).toHaveLength(before - 1);
    expect(s1.profiles.find((x) => x.id === p.id)).toBeUndefined();
  });

  it("deleteProfile returns false for unknown id", async () => {
    const result = await store.deleteProfile("hp_does_not_exist");
    expect(result).toBe(false);
  });

  it("deleteProfile re-assigns activeProfileId to first remaining profile when active is deleted", async () => {
    // Make the first profile active again
    const s0 = await store.listProfiles();
    const first = s0.profiles[0];
    await store.setActiveProfileId(first.id);

    const deleted = await store.deleteProfile(first.id);
    expect(deleted).toBe(true);

    const s1 = await store.listProfiles();
    // activeProfileId should have shifted to the next remaining profile (or null)
    if (s1.profiles.length > 0) {
      expect(s1.activeProfileId).toBe(s1.profiles[0].id);
    } else {
      expect(s1.activeProfileId).toBeNull();
    }
  });
});

// ─── Group 3: Migration helper ────────────────────────────────────────────────

describe("Hermes profile — migration from existing config", () => {
  const origDataDir = process.env.DATA_DIR;
  let tempDir;
  let store;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hermes-migrate-"));
    process.env.DATA_DIR = tempDir;
    const { vi } = await import("vitest");
    vi.resetModules();
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    store = await import("../../src/lib/hermes/profileStore.js");
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
  });

  it("migrateFromExistingConfig creates a 'default' profile from an existing model block", async () => {
    const modelCfg = {
      default: "cc/claude-sonnet-4-5",
      provider: "custom",
      base_url: "http://127.0.0.1:20128/v1",
    };
    const migrated = await store.migrateFromExistingConfig(modelCfg, "sk-migrated");
    expect(migrated).not.toBeNull();
    expect(migrated.profiles).toHaveLength(1);
    expect(migrated.profiles[0].name).toBe("default");
    expect(migrated.profiles[0].model).toBe("cc/claude-sonnet-4-5");
    expect(migrated.profiles[0].baseUrl).toBe("http://127.0.0.1:20128/v1");
    expect(migrated.profiles[0].apiKey).toBe("sk-migrated");
    expect(migrated.activeProfileId).toBe(migrated.profiles[0].id);
  });

  it("migrateFromExistingConfig returns null for non-local configs even when they have a model", async () => {
    const result = await store.migrateFromExistingConfig({
      default: "gpt-4o",
      provider: "custom",
      base_url: "https://api.openai.com/v1",
    }, "sk-should-not-import");
    expect(result).toBeNull();
  });

  it("migrateFromExistingConfig returns null for non-custom providers", async () => {
    const result = await store.migrateFromExistingConfig({
      default: "cc/claude-sonnet-4-5",
      provider: "openai",
      base_url: "http://127.0.0.1:20128/v1",
    }, "sk-should-not-import");
    expect(result).toBeNull();
  });

  it("migrateFromExistingConfig returns null when modelCfg has no base_url", async () => {
    const result = await store.migrateFromExistingConfig({ default: "m", provider: "custom" });
    expect(result).toBeNull();
  });

  it("migrateFromExistingConfig returns null when modelCfg has no default model", async () => {
    const result = await store.migrateFromExistingConfig({ base_url: "http://127.0.0.1:20128/v1" });
    expect(result).toBeNull();
  });

  it("migrateFromExistingConfig returns null for null input", async () => {
    const result = await store.migrateFromExistingConfig(null);
    expect(result).toBeNull();
  });
});

// ─── Group 4: applyProfile on-disk helpers ────────────────────────────────────

import {
  buildModelBlock,
  upsertModelBlock,
  removeModelBlock,
  upsertEnvVar,
  removeEnvVar,
  parseEnvVar,
  parseModelBlock,
  applyProfileToDisk,
} from "../../src/lib/hermes/applyProfile.js";

describe("Hermes legacy single-profile sync", () => {
  const origDataDir = process.env.DATA_DIR;
  let tempDir;
  let store;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hermes-legacy-sync-"));
    process.env.DATA_DIR = tempDir;
    const { vi } = await import("vitest");
    vi.resetModules();
    const db = await import("../../src/lib/db/index.js");
    await db.initDb();
    store = await import("../../src/lib/hermes/profileStore.js");
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
  });

  it("creates a default active profile when syncing legacy settings into an empty store", async () => {
    const synced = await store.syncActiveProfileFromLegacySettings({
      baseUrl: "http://127.0.0.1:20128",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-legacy",
    });
    expect(synced.name).toBe("default");
    expect(synced.baseUrl).toBe("http://127.0.0.1:20128/v1");
    expect(synced.apiKey).toBe("sk-legacy");

    const current = await store.getProfileStore();
    expect(current.profiles).toHaveLength(1);
    expect(current.activeProfileId).toBe(synced.id);
  });

  it("updates the active profile in place when syncing legacy settings again", async () => {
    const before = await store.getProfileStore();
    const activeId = before.activeProfileId;
    const activeName = before.profiles[0].name;

    const synced = await store.syncActiveProfileFromLegacySettings({
      baseUrl: "http://localhost:20128/v1",
      model: "cc/claude-opus-4",
      apiKey: "sk-updated",
    });

    expect(synced.id).toBe(activeId);
    expect(synced.name).toBe(activeName);
    expect(synced.model).toBe("cc/claude-opus-4");
    expect(synced.apiKey).toBe("sk-updated");
  });

  it("clears the active profile apiKey when syncing legacy settings with an empty apiKey", async () => {
    const before = await store.getProfileStore();
    const activeId = before.activeProfileId;

    const synced = await store.syncActiveProfileFromLegacySettings({
      baseUrl: "http://localhost:20128/v1",
      model: "cc/claude-opus-4",
      apiKey: "   ",
    });

    expect(synced.id).toBe(activeId);
    expect(synced.apiKey).toBeNull();
  });

  it("creates a fresh active profile after reset instead of clobbering the first stored profile", async () => {
    const before = await store.getProfileStore();
    const firstStoredProfile = structuredClone(before.profiles[0]);
    const secondStoredProfile = await store.createProfile({
      name: "backup",
      baseUrl: "http://127.0.0.1:20128",
      model: "cc/claude-haiku-4",
      apiKey: "sk-backup",
    });

    await store.saveProfileStore({
      profiles: [firstStoredProfile, secondStoredProfile],
      activeProfileId: null,
    });

    const synced = await store.syncActiveProfileFromLegacySettings({
      baseUrl: "http://0.0.0.0:20128",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-reset-legacy",
    });
    const current = await store.getProfileStore();

    expect(current.activeProfileId).toBe(synced.id);
    expect(current.profiles).toHaveLength(3);
    expect(current.profiles[0]).toMatchObject(firstStoredProfile);
    expect(current.profiles[1]).toMatchObject(secondStoredProfile);
    expect(current.profiles[2].id).toBe(synced.id);
    expect(current.profiles[2].name).toBe("default");
    expect(current.profiles[2].baseUrl).toBe("http://0.0.0.0:20128/v1");
    expect(current.profiles[2].model).toBe("cc/claude-sonnet-4");
    expect(current.profiles[2].apiKey).toBe("sk-reset-legacy");
  });

  it("clears the stored apiKey when legacy sync omits apiKey after disk cleanup", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hermes-legacy-sync-home-"));
    const envPath = path.join(tempHome, ".hermes", ".env");
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tempHome);

    try {
      const firstBaseUrl = "http://127.0.0.1:20128";
      const firstModel = "cc/claude-sonnet-4";
      await applyProfileToDisk({
        baseUrl: firstBaseUrl,
        model: firstModel,
        apiKey: "sk-old",
      });
      const firstSynced = await store.syncActiveProfileFromLegacySettings({
        baseUrl: firstBaseUrl,
        model: firstModel,
        apiKey: "sk-old",
      });

      await applyProfileToDisk({
        baseUrl: firstBaseUrl,
        model: "cc/claude-opus-4",
      });
      const secondSynced = await store.syncActiveProfileFromLegacySettings({
        baseUrl: firstBaseUrl,
        model: "cc/claude-opus-4",
      });

      expect(secondSynced.id).toBe(firstSynced.id);
      expect(secondSynced.apiKey).toBeNull();
      await expect(fs.promises.readFile(envPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });

      const current = await store.getProfileStore();
      const active = current.profiles.find((profile) => profile.id === current.activeProfileId);
      expect(active.apiKey).toBeNull();
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

// ─── Group 4: applyProfile on-disk helpers ────────────────────────────────────

describe("Hermes applyProfile — YAML helpers", () => {
  it("buildModelBlock renders correct YAML", () => {
    const block = buildModelBlock("cc/claude-sonnet-4", "http://127.0.0.1:20128/v1");
    expect(block).toContain('default: "cc/claude-sonnet-4"');
    expect(block).toContain('provider: "custom"');
    expect(block).toContain('base_url: "http://127.0.0.1:20128/v1"');
    expect(block.startsWith("model:\n")).toBe(true);
  });

  it("upsertModelBlock inserts model block into an empty YAML", () => {
    const result = upsertModelBlock("", buildModelBlock("m", "http://x"));
    expect(result).toContain("model:");
    expect(result).toContain('"m"');
  });

  it("upsertModelBlock replaces an existing model block", () => {
    const original = `model:\n  default: "old-model"\n  provider: "custom"\n  base_url: "http://old"\n\nother: value\n`;
    const result = upsertModelBlock(original, buildModelBlock("new-model", "http://new/v1"));
    expect(result).toContain('"new-model"');
    expect(result).not.toContain('"old-model"');
    expect(result).toContain("other: value");
  });

  it("removeModelBlock strips the model block", () => {
    const yaml = `model:\n  default: "m"\n  provider: "custom"\n  base_url: "http://x"\n\nother: value\n`;
    const result = removeModelBlock(yaml);
    expect(result).not.toContain("model:");
    expect(result).toContain("other: value");
  });

  it("removeModelBlock returns original when no model block present", () => {
    const yaml = "other: value\n";
    expect(removeModelBlock(yaml)).toBe(yaml);
  });

  it("parseModelBlock extracts fields from YAML", () => {
    const yaml = `model:\n  default: "cc/claude-sonnet-4"\n  provider: "custom"\n  base_url: "http://127.0.0.1:20128/v1"\n`;
    const parsed = parseModelBlock(yaml);
    expect(parsed).not.toBeNull();
    expect(parsed.default).toBe("cc/claude-sonnet-4");
    expect(parsed.provider).toBe("custom");
    expect(parsed.base_url).toBe("http://127.0.0.1:20128/v1");
  });

  it("parseModelBlock returns null when no model block present", () => {
    expect(parseModelBlock("other: value\n")).toBeNull();
  });

  it("upsertEnvVar adds a new key to an empty env file", () => {
    const result = upsertEnvVar("", "OPENAI_API_KEY", "sk-abc");
    expect(result).toContain("OPENAI_API_KEY=sk-abc");
  });

  it("upsertEnvVar replaces an existing key", () => {
    const existing = "OPENAI_API_KEY=sk-old\nOTHER=val\n";
    const result = upsertEnvVar(existing, "OPENAI_API_KEY", "sk-new");
    expect(result).toContain("OPENAI_API_KEY=sk-new");
    expect(result).not.toContain("sk-old");
    expect(result).toContain("OTHER=val");
  });

  it("upsertEnvVar replaces all duplicate existing keys", () => {
    const existing = "OPENAI_API_KEY=sk-old-1\nOTHER=1\nOPENAI_API_KEY=sk-old-2\n";
    const result = upsertEnvVar(existing, "OPENAI_API_KEY", "sk-new");
    expect(result).toBe("OPENAI_API_KEY=sk-new\nOTHER=1\n");
  });

  it("removeEnvVar strips the target key", () => {
    const env = "OPENAI_API_KEY=sk-abc\nOTHER=val\n";
    const result = removeEnvVar(env, "OPENAI_API_KEY");
    expect(result).not.toContain("OPENAI_API_KEY");
    expect(result).toContain("OTHER=val");
  });

  it("removeEnvVar strips all duplicate target keys", () => {
    const env = "OPENAI_API_KEY=sk-old-1\nOTHER=1\nOPENAI_API_KEY=sk-old-2\n";
    const result = removeEnvVar(env, "OPENAI_API_KEY");
    expect(result).toBe("OTHER=1\n");
  });

  it("parseEnvVar extracts a value from the env file", () => {
    const env = "OPENAI_API_KEY=sk-abc\nOTHER=val\n";
    expect(parseEnvVar(env, "OPENAI_API_KEY")).toBe("sk-abc");
  });

  it("applyProfileToDisk clears a stale API key when the next profile has no apiKey", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hermes-apply-disk-"));
    const hermesDir = path.join(tempHome, ".hermes");
    const envPath = path.join(hermesDir, ".env");
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tempHome);

    try {
      fs.mkdirSync(hermesDir, { recursive: true });
      fs.writeFileSync(envPath, "OTHER=keep\n");

      await applyProfileToDisk({
        baseUrl: "http://127.0.0.1:20128",
        model: "cc/claude-sonnet-4",
        apiKey: "sk-first",
      });
      await applyProfileToDisk({
        baseUrl: "http://127.0.0.1:20128",
        model: "cc/claude-opus-4",
      });

      expect(fs.readFileSync(envPath, "utf-8")).toBe("OTHER=keep\n");
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("applyProfileToDisk removes an empty .env after clearing the API key", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hermes-apply-disk-"));
    const envPath = path.join(tempHome, ".hermes", ".env");
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tempHome);

    try {
      await applyProfileToDisk({
        baseUrl: "http://127.0.0.1:20128",
        model: "cc/claude-sonnet-4",
        apiKey: "sk-first",
      });
      await applyProfileToDisk({
        baseUrl: "http://127.0.0.1:20128",
        model: "cc/claude-haiku-4",
        apiKey: "",
      });

      expect(fs.existsSync(envPath)).toBe(false);
    } finally {
      homedirSpy.mockRestore();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("upsertModelBlock + parseModelBlock are inverse operations (round-trip)", () => {
    const model = "cc/claude-sonnet-4";
    const baseUrl = "http://127.0.0.1:20128/v1";
    const yaml = upsertModelBlock("", buildModelBlock(model, baseUrl));
    const parsed = parseModelBlock(yaml);
    expect(parsed?.default).toBe(model);
    expect(parsed?.base_url).toBe(baseUrl);
  });
});
