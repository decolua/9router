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
  headroomTimeoutMs: 3000,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,

  // ---- Session-affinity scheduling (keeps one client session on one account) ----
  // Bind a conversation (session id) to a single upstream account so prompt cache
  // stays warm and concurrency is spread rather than stamped onto one account.
  //
  // Default OFF: this changes account-selection behaviour, and enabling it by
  // default would silently alter routing for every existing multi-account install
  // on upgrade (fill-first would stop honouring `priority` as soon as an account
  // reached the session cap). Opt-in from the Scheduling page instead.
  sessionBindingEnabled: false,
  // Soft cap: how many distinct sessions may share one account. 0 = unlimited.
  // Left unlimited by default so that merely turning affinity on does not also
  // impose a cap the user never asked for.
  maxSessionsPerAccount: 0,
  // What to do when every account is at/over maxSessionsPerAccount:
  //   "soft" = allow overflow onto the least-loaded account (log a warning)
  //   "hard" = treat as unavailable and fall through to another account / return 429
  sessionOverflowPolicy: "soft",
  // Release a binding after this long with no requests from the session.
  sessionIdleTtlMs: 30 * 60 * 1000,
  // Sweep interval for idle bindings.
  sessionBindingSweepIntervalMs: 5 * 60 * 1000,

  // ---- Account concurrency gate ----
  // Max in-flight requests allowed per upstream account. 0 = unlimited.
  // Guards against concentrating many parallel client requests onto one account.
  maxConcurrentPerAccount: 0,

  // ---- Quota-weighted scheduling ----
  // Global scheduling mode:
  //   "fill-first"        = legacy, always use the highest-priority account
  //   "round-robin"       = legacy sticky rotation
  //   "quota-weighted"    = score accounts by remaining quota × time-to-expiry
  schedulingMode: "fill-first",
  // Prefer accounts whose quota expires SOONER when scores are close, so a
  // 1000-point/10-day balance is burned before a 2000-point/15-day one.
  quotaPreferEarlierExpiry: true,
  // Weight of remaining-quota vs time-to-expiry in the quota-weighted score.
  quotaWeightRemaining: 1.0,
  quotaWeightExpiry: 0.5,
  // Exponential-backoff lock still applies to genuine (quota) 429s.
  // Concurrency-429 never locks an account.

  // ---- Diagnostics ----
  // Read-only session identity probe (no behaviour change). Also via env SESSION_PROBE=1.
  sessionProbeEnabled: false,
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
    next = { ...current, ...updates };
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
