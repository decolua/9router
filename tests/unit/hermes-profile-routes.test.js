import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeProfile(profile) {
  if (!profile) return null;
  const { apiKey, ...safeProfile } = profile;
  return {
    ...safeProfile,
    hasApiKey: Boolean(apiKey),
  };
}

function expectSanitizedProfile(profile, expected = {}) {
  expect(profile.apiKey).toBeUndefined();
  expect(profile.hasApiKey).toBe(expected.hasApiKey ?? true);
  if (expected.id !== undefined) expect(profile.id).toBe(expected.id);
  if (expected.name !== undefined) expect(profile.name).toBe(expected.name);
  if (expected.baseUrl !== undefined) expect(profile.baseUrl).toBe(expected.baseUrl);
  if (expected.model !== undefined) expect(profile.model).toBe(expected.model);
}

async function loadCollectionRoute({
  storeOverrides = {},
  diskOverrides = {},
} = {}) {
  vi.resetModules();
  vi.doMock("next/server", () => ({ NextResponse: { json } }));

  const store = {
    createProfile: vi.fn(),
    listProfiles: vi.fn(),
    looksLike9RouterConfig: vi.fn((modelCfg) => modelCfg?.provider === "custom" && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg?.base_url || "")),
    migrateFromExistingConfig: vi.fn(),
    sanitizeProfile: vi.fn(sanitizeProfile),
    validateProfileFields: vi.fn(() => []),
    ...storeOverrides,
  };
  const disk = {
    parseModelBlock: vi.fn(),
    readApiKeyFromEnv: vi.fn(),
    readConfigYaml: vi.fn(),
    ...diskOverrides,
  };

  vi.doMock("@/lib/hermes/profileStore.js", () => store);
  vi.doMock("@/lib/hermes/applyProfile.js", () => disk);

  const route = await import("../../src/app/api/cli-tools/hermes-profiles/route.js");
  return { route, store, disk };
}

async function loadItemRoute({
  storeOverrides = {},
  diskOverrides = {},
} = {}) {
  vi.resetModules();
  vi.doMock("next/server", () => ({ NextResponse: { json } }));

  const store = {
    deleteProfile: vi.fn(),
    getProfileById: vi.fn(),
    listProfiles: vi.fn(),
    sanitizeProfile: vi.fn(sanitizeProfile),
    updateProfile: vi.fn(),
    ...storeOverrides,
  };
  const disk = {
    applyProfileToDisk: vi.fn(),
    removeProfileFromDisk: vi.fn(),
    ...diskOverrides,
  };

  vi.doMock("@/lib/hermes/profileStore.js", () => store);
  vi.doMock("@/lib/hermes/applyProfile.js", () => disk);

  const route = await import("../../src/app/api/cli-tools/hermes-profiles/[id]/route.js");
  return { route, store, disk };
}

async function loadActivateRoute({
  storeOverrides = {},
  diskOverrides = {},
} = {}) {
  vi.resetModules();
  vi.doMock("next/server", () => ({ NextResponse: { json } }));

  const store = {
    getProfileById: vi.fn(),
    listProfiles: vi.fn().mockResolvedValue({ activeProfileId: null, profiles: [] }),
    sanitizeProfile: vi.fn(sanitizeProfile),
    setActiveProfileId: vi.fn(),
    ...storeOverrides,
  };
  const disk = {
    applyProfileToDisk: vi.fn(),
    removeProfileFromDisk: vi.fn(),
    ...diskOverrides,
  };

  vi.doMock("@/lib/hermes/profileStore.js", () => store);
  vi.doMock("@/lib/hermes/applyProfile.js", () => disk);

  const route = await import("../../src/app/api/cli-tools/hermes-profiles/[id]/activate/route.js");
  return { route, store, disk };
}

async function loadSettingsRoute({
  storeOverrides = {},
  diskOverrides = {},
  osOverrides = null,
} = {}) {
  vi.resetModules();
  vi.doMock("next/server", () => ({ NextResponse: { json } }));

  const store = {
    clearActiveProfileId: vi.fn(),
    listProfiles: vi.fn().mockResolvedValue({ activeProfileId: null, profiles: [] }),
    looksLike9RouterConfig: vi.fn((modelCfg) => modelCfg?.provider === "custom" && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(modelCfg?.base_url || "")),
    syncActiveProfileFromLegacySettings: vi.fn(),
    ...storeOverrides,
  };
  const disk = {
    applyProfileToDisk: vi.fn(),
    parseModelBlock: vi.fn(),
    readConfigYaml: vi.fn(),
    removeProfileFromDisk: vi.fn(),
    ...diskOverrides,
  };

  vi.doMock("@/lib/hermes/profileStore.js", () => store);
  vi.doMock("@/lib/hermes/applyProfile.js", () => disk);

  if (osOverrides) {
    vi.doMock("os", async () => {
      const actual = await vi.importActual("os");
      const mockedOs = {
        ...actual,
        ...osOverrides,
      };
      return {
        ...mockedOs,
        default: mockedOs,
      };
    });
  }

  const route = await import("../../src/app/api/cli-tools/hermes-settings/route.js");
  return { route, store, disk };
}

function makePutRequest(body) {
  return new Request("https://9router.local/api/cli-tools/hermes-profiles/p1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.doUnmock("next/server");
  vi.doUnmock("os");
  vi.doUnmock("@/lib/hermes/profileStore.js");
  vi.doUnmock("@/lib/hermes/applyProfile.js");
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hermes profile routes", () => {
  it("sanitizes list responses and activeProfile payloads", async () => {
    const rawProfile = {
      id: "p1",
      name: "default",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-secret",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };
    const { route } = await loadCollectionRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockResolvedValue({
          profiles: [rawProfile],
          activeProfileId: rawProfile.id,
        }),
      },
    });

    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activeProfileId).toBe("p1");
    expect(body.profiles).toHaveLength(1);
    expectSanitizedProfile(body.profiles[0], { id: "p1", name: "default", hasApiKey: true });
    expectSanitizedProfile(body.activeProfile, { id: "p1", name: "default", hasApiKey: true });
  });

  it("does not auto-migrate non-local existing Hermes configs or read .env secrets", async () => {
    const { route, store, disk } = await loadCollectionRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockResolvedValue({ profiles: [], activeProfileId: null }),
        looksLike9RouterConfig: vi.fn().mockReturnValue(false),
      },
      diskOverrides: {
        readConfigYaml: vi.fn().mockResolvedValue("model:\n  default: \"gpt-4\"\n  provider: \"openai\"\n  base_url: \"https://api.openai.com/v1\"\n"),
        parseModelBlock: vi.fn().mockReturnValue({
          default: "gpt-4",
          provider: "openai",
          base_url: "https://api.openai.com/v1",
        }),
      },
    });

    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profiles).toEqual([]);
    expect(body.activeProfile).toBeNull();
    expect(store.looksLike9RouterConfig).toHaveBeenCalledTimes(1);
    expect(disk.readApiKeyFromEnv).not.toHaveBeenCalled();
    expect(store.migrateFromExistingConfig).not.toHaveBeenCalled();
  });

  it("sanitizes create responses", async () => {
    const rawProfile = {
      id: "p1",
      name: "work",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-opus-4",
      apiKey: "sk-created",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };
    const { route, store } = await loadCollectionRoute({
      storeOverrides: {
        createProfile: vi.fn().mockResolvedValue(rawProfile),
      },
    });

    const response = await route.POST(new Request("https://9router.local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: rawProfile.name,
        baseUrl: rawProfile.baseUrl,
        model: rawProfile.model,
        apiKey: rawProfile.apiKey,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(store.createProfile).toHaveBeenCalledWith({
      name: rawProfile.name,
      baseUrl: rawProfile.baseUrl,
      model: rawProfile.model,
      apiKey: rawProfile.apiKey,
    });
    expectSanitizedProfile(body.profile, { id: "p1", name: "work", hasApiKey: true });
  });

  it("sanitizes get responses", async () => {
    const rawProfile = {
      id: "p1",
      name: "work",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-opus-4",
      apiKey: "sk-secret",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };
    const { route } = await loadItemRoute({
      storeOverrides: {
        getProfileById: vi.fn().mockResolvedValue(rawProfile),
      },
    });

    const response = await route.GET(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expectSanitizedProfile(body.profile, { id: "p1", name: "work", hasApiKey: true });
  });

  it("re-applies disk settings before updating the active profile and sanitizes the response", async () => {
    const existing = {
      id: "p1",
      name: "work",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-updated",
    };
    const updated = {
      ...existing,
      model: "cc/claude-opus-4",
    };
    const { route, store, disk } = await loadItemRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockResolvedValue({ activeProfileId: "p1", profiles: [existing] }),
        updateProfile: vi.fn().mockResolvedValue(updated),
      },
    });

    const response = await route.PUT(makePutRequest({ model: updated.model }), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile.model).toBe(updated.model);
    expect(body.profile.apiKey).toBeUndefined();
    expect(body.profile.hasApiKey).toBe(true);
    expect(store.updateProfile).toHaveBeenCalledWith("p1", { model: updated.model });
    expect(disk.applyProfileToDisk).toHaveBeenCalledWith(updated);
    expect(disk.applyProfileToDisk.mock.invocationCallOrder[0])
      .toBeLessThan(store.updateProfile.mock.invocationCallOrder[0]);
  });

  it("activates profiles using the stored secret server-side but returns a sanitized profile", async () => {
    const rawProfile = {
      id: "p1",
      name: "default",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-activate",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };
    const { route, store, disk } = await loadActivateRoute({
      storeOverrides: {
        getProfileById: vi.fn().mockResolvedValue(rawProfile),
        listProfiles: vi.fn().mockResolvedValue({
          activeProfileId: null,
          profiles: [rawProfile],
        }),
        setActiveProfileId: vi.fn().mockResolvedValue(rawProfile),
      },
    });

    const response = await route.POST(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(disk.applyProfileToDisk).toHaveBeenCalledWith({
      baseUrl: rawProfile.baseUrl,
      model: rawProfile.model,
      apiKey: rawProfile.apiKey,
    });
    expect(store.setActiveProfileId).toHaveBeenCalledWith("p1");
    expectSanitizedProfile(body.profile, { id: "p1", name: "default", hasApiKey: true });
  });

  it("rolls back the disk config to the previous active profile when activate store update fails", async () => {
    const previousActive = {
      id: "p0",
      name: "previous",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-haiku-4",
      apiKey: "sk-previous",
    };
    const targetProfile = {
      id: "p1",
      name: "default",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-activate",
    };
    const { route, store, disk } = await loadActivateRoute({
      storeOverrides: {
        getProfileById: vi.fn().mockResolvedValue(targetProfile),
        listProfiles: vi.fn().mockResolvedValue({
          activeProfileId: previousActive.id,
          profiles: [previousActive, targetProfile],
        }),
        setActiveProfileId: vi.fn().mockRejectedValue(new Error("db locked")),
      },
    });

    const response = await route.POST(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to activate hermes profile");
    expect(store.setActiveProfileId).toHaveBeenCalledWith("p1");
    expect(disk.applyProfileToDisk).toHaveBeenNthCalledWith(1, {
      baseUrl: targetProfile.baseUrl,
      model: targetProfile.model,
      apiKey: targetProfile.apiKey,
    });
    expect(disk.applyProfileToDisk).toHaveBeenNthCalledWith(2, previousActive);
    expect(disk.removeProfileFromDisk).not.toHaveBeenCalled();
  });

  it("does not return success when activate loses the profile and rolls disk back to reset state", async () => {
    const targetProfile = {
      id: "p1",
      name: "default",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-activate",
    };
    const { route, store, disk } = await loadActivateRoute({
      storeOverrides: {
        getProfileById: vi.fn().mockResolvedValue(targetProfile),
        listProfiles: vi.fn().mockResolvedValue({
          activeProfileId: null,
          profiles: [targetProfile],
        }),
        setActiveProfileId: vi.fn().mockResolvedValue(null),
      },
    });

    const response = await route.POST(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Profile not found");
    expect(store.setActiveProfileId).toHaveBeenCalledWith("p1");
    expect(disk.applyProfileToDisk).toHaveBeenCalledTimes(1);
    expect(disk.removeProfileFromDisk).toHaveBeenCalledTimes(1);
  });

  it("activates the fallback profile on disk before deleting the active profile", async () => {
    const fallback = {
      id: "p2",
      name: "backup",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-fallback",
    };
    const { route, store, disk } = await loadItemRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockResolvedValue({
          activeProfileId: "p1",
          profiles: [{ id: "p1" }, fallback],
        }),
        deleteProfile: vi.fn().mockResolvedValue(true),
      },
    });

    const response = await route.DELETE(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(disk.applyProfileToDisk).toHaveBeenCalledWith(fallback);
    expect(disk.removeProfileFromDisk).not.toHaveBeenCalled();
    expect(disk.applyProfileToDisk.mock.invocationCallOrder[0])
      .toBeLessThan(store.deleteProfile.mock.invocationCallOrder[0]);
  });

  it("removes the model block from disk before deleting the last active profile", async () => {
    const { route, store, disk } = await loadItemRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockResolvedValue({
          activeProfileId: "p1",
          profiles: [{ id: "p1" }],
        }),
        deleteProfile: vi.fn().mockResolvedValue(true),
      },
    });

    const response = await route.DELETE(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(disk.applyProfileToDisk).not.toHaveBeenCalled();
    expect(disk.removeProfileFromDisk).toHaveBeenCalledTimes(1);
    expect(disk.removeProfileFromDisk.mock.invocationCallOrder[0])
      .toBeLessThan(store.deleteProfile.mock.invocationCallOrder[0]);
  });

  it("does not update the active profile in store when disk apply fails during update", async () => {
    const state = {
      activeProfileId: "p1",
      profiles: [{
        id: "p1",
        name: "work",
        baseUrl: "http://127.0.0.1:20128/v1",
        model: "cc/claude-sonnet-4",
        apiKey: "sk-secret",
      }],
    };
    const { route, store } = await loadItemRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockImplementation(async () => structuredClone(state)),
        updateProfile: vi.fn().mockImplementation(async (_id, updates) => {
          state.profiles[0] = { ...state.profiles[0], ...updates };
          return state.profiles[0];
        }),
      },
      diskOverrides: {
        applyProfileToDisk: vi.fn().mockRejectedValue(new Error("disk full")),
      },
    });

    const response = await route.PUT(makePutRequest({ model: "cc/claude-opus-4" }), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to update hermes profile");
    expect(store.updateProfile).not.toHaveBeenCalled();
    expect(state).toEqual({
      activeProfileId: "p1",
      profiles: [{
        id: "p1",
        name: "work",
        baseUrl: "http://127.0.0.1:20128/v1",
        model: "cc/claude-sonnet-4",
        apiKey: "sk-secret",
      }],
    });
  });

  it("does not delete the active profile from store when fallback disk apply fails", async () => {
    const active = {
      id: "p1",
      name: "work",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-active",
    };
    const fallback = {
      id: "p2",
      name: "backup",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-opus-4",
      apiKey: "sk-fallback",
    };
    const state = {
      activeProfileId: active.id,
      profiles: [active, fallback],
    };
    const { route, store } = await loadItemRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockImplementation(async () => structuredClone(state)),
        deleteProfile: vi.fn().mockImplementation(async (id) => {
          state.profiles = state.profiles.filter((profile) => profile.id !== id);
          state.activeProfileId = state.profiles[0]?.id ?? null;
          return true;
        }),
      },
      diskOverrides: {
        applyProfileToDisk: vi.fn().mockRejectedValue(new Error("disk full")),
      },
    });

    const response = await route.DELETE(new Request("https://9router.local"), {
      params: Promise.resolve({ id: "p1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to delete hermes profile");
    expect(store.deleteProfile).not.toHaveBeenCalled();
    expect(state).toEqual({
      activeProfileId: active.id,
      profiles: [active, fallback],
    });
  });

  it("rolls disk back when legacy settings store sync fails after apply", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-settings-rollback-"));
    const hermesDir = path.join(tempHome, ".hermes");
    const configPath = path.join(hermesDir, "config.yaml");
    const envPath = path.join(hermesDir, ".env");
    const originalConfig = "model:\n  default: \"cc/claude-haiku-4\"\n  provider: \"custom\"\n  base_url: \"http://127.0.0.1:20128/v1\"\n\nother: keep\n";

    await fs.mkdir(hermesDir, { recursive: true });
    await fs.writeFile(configPath, originalConfig);

    try {
      const { route, store, disk } = await loadSettingsRoute({
        storeOverrides: {
          syncActiveProfileFromLegacySettings: vi.fn().mockRejectedValue(new Error("db locked")),
        },
        diskOverrides: {
          applyProfileToDisk: vi.fn().mockImplementation(async ({ baseUrl, model, apiKey }) => {
            const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
            await fs.writeFile(configPath, `model:\n  default: \"${model}\"\n  provider: \"custom\"\n  base_url: \"${normalizedBaseUrl}\"\n`);
            await fs.writeFile(envPath, `OPENAI_API_KEY=${apiKey}\n`);
          }),
        },
        osOverrides: {
          homedir: () => tempHome,
        },
      });

      const response = await route.POST(new Request("https://9router.local/api/cli-tools/hermes-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://127.0.0.1:20128",
          model: "cc/claude-opus-4",
          apiKey: "sk-new",
        }),
      }));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Failed to update hermes settings");
      expect(disk.applyProfileToDisk).toHaveBeenCalledTimes(1);
      expect(store.syncActiveProfileFromLegacySettings).toHaveBeenCalledTimes(1);
      await expect(fs.readFile(configPath, "utf-8")).resolves.toBe(originalConfig);
      await expect(fs.readFile(envPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  it("does not clear the active profile marker when disk reset fails", async () => {
    const active = {
      id: "p1",
      name: "work",
      baseUrl: "http://127.0.0.1:20128/v1",
      model: "cc/claude-sonnet-4",
      apiKey: "sk-active",
    };
    const state = {
      activeProfileId: active.id,
      profiles: [active],
    };
    const { route, store } = await loadSettingsRoute({
      storeOverrides: {
        listProfiles: vi.fn().mockImplementation(async () => structuredClone(state)),
        clearActiveProfileId: vi.fn().mockImplementation(async () => {
          state.activeProfileId = null;
          return state;
        }),
      },
      diskOverrides: {
        removeProfileFromDisk: vi.fn().mockRejectedValue(new Error("disk full")),
      },
    });

    const response = await route.DELETE();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to reset hermes settings");
    expect(store.clearActiveProfileId).not.toHaveBeenCalled();
    expect(state).toEqual({
      activeProfileId: active.id,
      profiles: [active],
    });
  });

  it("reset clears the active profile marker as well as the on-disk config", async () => {
    const { route, store, disk } = await loadSettingsRoute();

    const response = await route.DELETE();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(store.clearActiveProfileId).toHaveBeenCalledTimes(1);
    expect(disk.removeProfileFromDisk).toHaveBeenCalledTimes(1);
    expect(disk.removeProfileFromDisk.mock.invocationCallOrder[0])
      .toBeLessThan(store.clearActiveProfileId.mock.invocationCallOrder[0]);
  });
});
