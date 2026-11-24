import { endCaptureWindow } from "../logRetention.js";
import { COMPRESSION_PROFILES, isCompressionProfile } from "../../../../open-sse/config/compressionProfiles.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

import { nextSessionEpoch } from "../../auth/dashboardRoles.js";

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
  sessionEpoch: 0,
  ssoAdminEmails: [],
  ssoAdminGroups: [],
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
  enableObservability: process.env.OBSERVABILITY_ENABLED !== "false",
  debugBodyLoggingUntil: null,
  auditRetentionDays: 180,
  observabilityMaxRecords: 200,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  compressionProfile: "custom",
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  headroomTimeoutMs: 3000,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  // User-authored system prompt, injected independently of the built-in savers.
  customPromptEnabled: false,
  customPrompt: "",
  // REA allow: replace built-in security-policy paragraphs with REA guidance.
  reaAllowEnabled: false,
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Per-provider user header overrides applied at dispatch: { [providerId]: { headers: {..} } }
  providerOverrides: {},
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
  if (merged.capacityAdapter && typeof merged.capacityAdapter === "object") {
    for (const capKey of Object.keys(merged.capacityAdapter)) {
      const entry = merged.capacityAdapter[capKey];
      if (Array.isArray(entry?.models)) {
        entry.models = entry.models.map((m) =>
          m === "oc/mimo-v2.5-free" ? "oc/mimo-v2.6-flash-free" : m
        );
      }
    }
  }
  if (!isCompressionProfile(merged.compressionProfile)) merged.compressionProfile = "custom";
  return Object.assign(merged, COMPRESSION_PROFILES[merged.compressionProfile]);
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates, { revokeSessions = false, providerRouting } = {}) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates, sessionEpoch: current.sessionEpoch ?? 0 };
    if (providerRouting) {
      const { provider, strategy, stickyLimit } = providerRouting;
      const strategies = { ...current.providerStrategies };
      const override = { ...strategies[provider] };
      delete override.fallbackStrategy;
      delete override.stickyRoundRobinLimit;
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin") override.stickyRoundRobinLimit = stickyLimit;
      if (Object.keys(override).length) strategies[provider] = override;
      else delete strategies[provider];
      next.providerStrategies = strategies;
    }
    if (revokeSessions || Object.hasOwn(updates, "password")) next.sessionEpoch = nextSessionEpoch(current);
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
  // Epoch belongs to this installation, not to a portable settings dump.
  const settings = await readRaw();
  delete settings.sessionEpoch;
  delete settings.debugBodyLoggingUntil;
  return settings;
}

// Closing the old window and publishing its replacement must commit together.
export async function updateDebugCaptureWindow(until) {
  const db = await getAdapter();
  db.transaction(() => {
    endCaptureWindow(db);
    db.run(`INSERT INTO settings(id,data) VALUES(1,json_object('debugBodyLoggingUntil',?))
      ON CONFLICT(id) DO UPDATE SET data=json_set(settings.data,'$.debugBodyLoggingUntil',?)`, [until, until]);
  });
}
