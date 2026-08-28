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
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  ssoType: "oidc",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  samlEntryPoint: "",
  samlIssuer: "urn:9router:sp",
  samlCert: "",
  samlLoginLabel: "Sign in with SAML SSO",
  samlAttributeEmail: "email",
  samlAttributeName: "name",
  enableObservability: false,
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
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Claude compat layer (see src/lib/claudeCompat.js): suffixMode controls
  // when [1m] is appended to rewritten /v1/models ids.
  claudeCompat: {
    enabled: true,
    suffixMode: "auto",
    keywords: [],
  },
  // Default-model mapping written to ~/.claude/settings.json env by the
  // endpoint page's one-click button (see /api/claude-compat/write-claude-settings).
  claudeDefaultModels: {
    sonnet: { model: "", name: "", oneM: false },
    opus: { model: "", name: "", oneM: false },
    fable: { model: "", name: "", oneM: false },
    haiku: { model: "", name: "", oneM: false },
    subagent: { model: "", oneM: false },
  },
  // User contextWindow overrides, keyed by model id or glob pattern (e.g.
  // "glm-5.3" or "glm-5*"). Consumed by open-sse/providers/capabilities.js
  // via setContextWindowOverrides(); managed on /dashboard/model-context.
  contextWindowOverrides: {},
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
export function mergeWithDefaults(raw) {
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
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    // Nested config objects arrive as partial PATCHes from the dashboard;
    // shallow top-level spread would replace them wholesale and drop
    // sibling keys (e.g. { claudeCompat: { keywords } } losing enabled).
    // Seed from defaults first so even the FIRST patch merges correctly
    // (raw current may not have the key yet).
    const seeded = mergeWithDefaults(current);
    const mergedCurrent = { ...current };
    // claudeCompat arrives as a partial PATCH (e.g. only { keywords }) and
    // needs merging to keep sibling keys like enabled. contextWindowOverrides
    // is deliberately excluded: the model-context API sends the WHOLE map
    // (delete removes a key), and merging would resurrect deleted keys.
    for (const key of ["claudeCompat"]) {
      if (
        updates[key] && typeof updates[key] === "object" &&
        seeded[key] && typeof seeded[key] === "object"
      ) {
        updates = { ...updates, [key]: { ...seeded[key], ...updates[key] } };
      }
    }
    next = { ...mergedCurrent, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
    );
  });
  return mergeWithDefaults(next);
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
