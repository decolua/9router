/**
 * Hermes multi-profile store (Issue #1952).
 *
 * Profiles are persisted in the server SQLite KV store under scope="hermes",
 * key="profiles_v1".  Each profile carries the fields needed to write a Hermes
 * config.yaml model block + the matching .env API key.
 *
 * The active profile is the one whose settings are currently written to disk
 * (~/.hermes/config.yaml and ~/.hermes/.env).
 *
 * Migration: when the store is empty but the on-disk config.yaml already
 * contains a 9Router model block, a "default" profile is created automatically
 * so existing single-profile users lose nothing.
 *
 * @module src/lib/hermes/profileStore
 */

import { makeKv } from "@/lib/db/helpers/kvStore.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const KV_SCOPE = "hermes";
const KV_KEY = "profiles_v1";

// ─── Pure helpers (testable without DB) ──────────────────────────────────────

/**
 * Generate a stable, short profile ID that is safe to use as a URL segment.
 * Format: hp_<13-char base36 timestamp>_<6-char random>.
 * @returns {string}
 */
export function generateProfileId() {
  return `hp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ensure a baseUrl ends with "/v1".
 * @param {string} url
 * @returns {string}
 */
export function normalizeBaseUrl(url) {
  if (!url) return url;
  const trimmed = url.trim();
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function normalizeLegacyApiKey(apiKey) {
  if (typeof apiKey !== "string") return null;
  const trimmed = apiKey.trim();
  return trimmed || null;
}

/**
 * Validate a profile's required fields.
 * @param {{ name?: any, baseUrl?: any, model?: any }} p
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateProfileFields(p) {
  const errors = [];
  if (!p.name || typeof p.name !== "string" || !p.name.trim()) {
    errors.push("name is required");
  }
  if (!p.baseUrl || typeof p.baseUrl !== "string" || !p.baseUrl.trim()) {
    errors.push("baseUrl is required");
  }
  if (!p.model || typeof p.model !== "string" || !p.model.trim()) {
    errors.push("model is required");
  }
  return errors;
}

/**
 * Build a new profile object with defaults.
 * @param {{ name: string, baseUrl: string, model: string, apiKey?: string|null }} fields
 * @returns {HermesProfile}
 */
export function buildProfile({ name, baseUrl, model, apiKey = null }) {
  const now = new Date().toISOString();
  return {
    id: generateProfileId(),
    name: name.trim(),
    baseUrl: normalizeBaseUrl(baseUrl),
    model: model.trim(),
    apiKey: apiKey || null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Determine whether a base URL points at a local 9Router instance.
 * @param {string|null|undefined} baseUrl
 * @returns {boolean}
 */
export function isLocal9RouterBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") return false;
  const trimmed = baseUrl.trim();
  return /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed);
}

/**
 * Determine whether a parsed model block looks like a local 9Router config.
 * @param {{ base_url?: string, provider?: string } | null} modelCfg
 * @returns {boolean}
 */
export function looksLike9RouterConfig(modelCfg) {
  if (!modelCfg?.base_url) return false;
  return modelCfg.provider === "custom" && isLocal9RouterBaseUrl(modelCfg.base_url);
}

/**
 * Strip secrets from a profile before returning it from an API.
 * @param {HermesProfile|null|undefined} profile
 * @returns {Omit<HermesProfile, "apiKey"> & { hasApiKey: boolean } | null}
 */
export function sanitizeProfile(profile) {
  if (!profile) return null;
  const { apiKey, ...safeProfile } = profile;
  return {
    ...safeProfile,
    hasApiKey: Boolean(apiKey),
  };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/** @returns {ReturnType<typeof makeKv>} */
function getKv() {
  return makeKv(KV_SCOPE);
}

/**
 * @typedef {{ profiles: HermesProfile[], activeProfileId: string|null }} ProfileStore
 * @typedef {{ id: string, name: string, baseUrl: string, model: string, apiKey: string|null, createdAt: string, updatedAt: string }} HermesProfile
 */

/**
 * Read the full profile store from the DB.
 * @returns {Promise<ProfileStore>}
 */
export async function getProfileStore() {
  const kv = getKv();
  const data = await kv.get(KV_KEY, { profiles: [], activeProfileId: null });
  return {
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    activeProfileId: data.activeProfileId || null,
  };
}

/**
 * Persist the full profile store to the DB.
 * @param {ProfileStore} data
 * @returns {Promise<void>}
 */
export async function saveProfileStore(data) {
  const kv = getKv();
  await kv.set(KV_KEY, {
    profiles: data.profiles,
    activeProfileId: data.activeProfileId || null,
  });
}

// ─── CRUD operations ──────────────────────────────────────────────────────────

/**
 * List all profiles.
 * @returns {Promise<ProfileStore>}
 */
export async function listProfiles() {
  return getProfileStore();
}

/**
 * Get a single profile by ID.
 * @param {string} id
 * @returns {Promise<HermesProfile|null>}
 */
export async function getProfileById(id) {
  const { profiles } = await getProfileStore();
  return profiles.find((p) => p.id === id) ?? null;
}

/**
 * Create a new profile. New profiles are not marked active until the caller
 * explicitly activates one (which also writes the profile to disk).
 * @param {{ name: string, baseUrl: string, model: string, apiKey?: string|null }} fields
 * @returns {Promise<HermesProfile>}
 */
export async function createProfile(fields) {
  const profile = buildProfile(fields);
  const store = await getProfileStore();
  store.profiles.push(profile);
  await saveProfileStore(store);
  return profile;
}

/**
 * Update an existing profile by ID.
 * @param {string} id
 * @param {{ name?: string, baseUrl?: string, model?: string, apiKey?: string|null }} updates
 * @returns {Promise<HermesProfile|null>} Updated profile, or null if not found.
 */
export async function updateProfile(id, updates) {
  const store = await getProfileStore();
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const existing = store.profiles[idx];
  const merged = { ...existing };

  if (updates.name !== undefined) merged.name = String(updates.name).trim();
  if (updates.baseUrl !== undefined) merged.baseUrl = normalizeBaseUrl(updates.baseUrl);
  if (updates.model !== undefined) merged.model = String(updates.model).trim();
  if (Object.prototype.hasOwnProperty.call(updates, "apiKey")) {
    merged.apiKey = updates.apiKey || null;
  }
  merged.updatedAt = new Date().toISOString();

  store.profiles[idx] = merged;
  await saveProfileStore(store);
  return store.profiles[idx];
}

/**
 * Delete a profile by ID.  If the deleted profile was the active one, the
 * first remaining profile (if any) becomes active (without disk write).
 * @param {string} id
 * @returns {Promise<boolean>} true if deleted, false if not found.
 */
export async function deleteProfile(id) {
  const store = await getProfileStore();
  const before = store.profiles.length;
  store.profiles = store.profiles.filter((p) => p.id !== id);
  if (store.profiles.length === before) return false;

  if (store.activeProfileId === id) {
    store.activeProfileId = store.profiles.length > 0 ? store.profiles[0].id : null;
  }
  await saveProfileStore(store);
  return true;
}

/**
 * Mark a profile as active in the DB (does NOT write to disk).
 * Use activateProfile() to also write settings to disk.
 * @param {string} id
 * @returns {Promise<HermesProfile|null>} The activated profile, or null if not found.
 */
export async function setActiveProfileId(id) {
  const store = await getProfileStore();
  const profile = store.profiles.find((p) => p.id === id);
  if (!profile) return null;
  store.activeProfileId = id;
  await saveProfileStore(store);
  return profile;
}

/**
 * Clear the active profile marker without deleting stored profiles.
 * @returns {Promise<ProfileStore>}
 */
export async function clearActiveProfileId() {
  const store = await getProfileStore();
  store.activeProfileId = null;
  await saveProfileStore(store);
  return store;
}

// ─── Migration helper ─────────────────────────────────────────────────────────

/**
 * Auto-migrate from an existing on-disk Hermes config to a "default" profile.
 * Only called when the store is empty.
 *
 * @param {{ default?: string|null, base_url?: string|null }} modelCfg
 *   Parsed model block from config.yaml (from hermes-settings GET handler).
 * @param {string|null} apiKey
 *   Parsed OPENAI_API_KEY from ~/.hermes/.env when available.
 * @returns {Promise<ProfileStore|null>} New store, or null if migration not possible.
 */
export async function migrateFromExistingConfig(modelCfg, apiKey = null) {
  if (!looksLike9RouterConfig(modelCfg) || !modelCfg?.default) return null;
  const profile = buildProfile({
    name: "default",
    baseUrl: modelCfg.base_url,
    model: modelCfg.default,
    apiKey,
  });
  const store = { profiles: [profile], activeProfileId: profile.id };
  await saveProfileStore(store);
  return store;
}

/**
 * Keep the active profile store aligned with legacy single-profile writes.
 * If a currently active profile exists, update it in place. If the active
 * marker was cleared (for example after reset), create a fresh "default"
 * profile instead of mutating some other stored profile implicitly.
 *
 * @param {{ baseUrl: string, model: string, apiKey?: string|null }} fields
 * @returns {Promise<HermesProfile>}
 */
export async function syncActiveProfileFromLegacySettings({ baseUrl, model, apiKey }) {
  const store = await getProfileStore();
  const normalizedApiKey = normalizeLegacyApiKey(apiKey);
  const buildLegacyProfile = () => buildProfile({
    name: "default",
    baseUrl,
    model,
    apiKey: normalizedApiKey,
  });

  if (!store.activeProfileId) {
    const profile = buildLegacyProfile();
    const nextStore = {
      profiles: [...store.profiles, profile],
      activeProfileId: profile.id,
    };
    await saveProfileStore(nextStore);
    return profile;
  }

  const idx = store.profiles.findIndex((profile) => profile.id === store.activeProfileId);
  if (idx === -1) {
    const profile = buildLegacyProfile();
    const nextStore = {
      profiles: [...store.profiles, profile],
      activeProfileId: profile.id,
    };
    await saveProfileStore(nextStore);
    return profile;
  }

  const existing = store.profiles[idx];
  const updated = {
    ...existing,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: String(model).trim(),
    apiKey: normalizedApiKey,
    updatedAt: new Date().toISOString(),
  };
  store.profiles[idx] = updated;
  store.activeProfileId = updated.id;
  await saveProfileStore(store);
  return updated;
}
