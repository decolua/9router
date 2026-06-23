import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  adminApiKeyHash: "",
  adminApiKeyCreatedAt: "",
  adminApiKeyUpdatedAt: "",
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  return mergeWithDefaults(next);
}

export class AdminApiKeyRotationConflictError extends Error {
  constructor({ expectedUpdatedAt, currentUpdatedAt }) {
    super("Admin API key was modified by another rotation");
    this.name = "AdminApiKeyRotationConflictError";
    this.code = "ADMIN_API_KEY_ROTATION_CONFLICT";
    this.expectedUpdatedAt = expectedUpdatedAt;
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

export async function rotateAdminApiKeySettings({ now = new Date(), expectedUpdatedAt, generateKey, hashKey }) {
  if (typeof generateKey !== "function" || typeof hashKey !== "function") {
    throw new Error("Admin API key rotation requires key generation and hashing functions");
  }

  const db = await getAdapter();
  let result;
  const hasExpectedVersion = expectedUpdatedAt !== undefined;
  const normalizedExpectedUpdatedAt = expectedUpdatedAt || "";

  // Native SQLite adapters serialize writers across processes here. The sql.js
  // fallback is process-local, so multi-process deployments should use a native
  // SQLite driver for cross-process rotation safety.
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    const currentUpdatedAt = current.adminApiKeyUpdatedAt || "";
    if (hasExpectedVersion && normalizedExpectedUpdatedAt !== currentUpdatedAt) {
      throw new AdminApiKeyRotationConflictError({
        expectedUpdatedAt: normalizedExpectedUpdatedAt,
        currentUpdatedAt,
      });
    }

    const timestamp = now.toISOString();
    const key = generateKey();
    const updates = {
      adminApiKeyHash: hashKey(key),
      adminApiKeyCreatedAt: current.adminApiKeyCreatedAt || timestamp,
      adminApiKeyUpdatedAt: timestamp,
    };
    const next = { ...current, ...updates };

    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );

    result = {
      key,
      status: {
        configured: true,
        createdAt: updates.adminApiKeyCreatedAt,
        updatedAt: updates.adminApiKeyUpdatedAt,
      },
    };
  });

  return result;
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
