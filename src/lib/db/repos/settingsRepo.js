import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { findMatchingSkipRule } from "open-sse/services/accountFallback.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

// Default skip-rule: Antigravity capacity fail-fast, shipped as an ordinary,
// user-editable rule. Matches 503 AND body text containing "capacity" (covers both
// MODEL_CAPACITY_EXHAUSTED and "No capacity available for model"). sweep:true
// re-sweeps the whole account pool on momentary capacity saturation.
export const DEFAULT_ANTIGRAVITY_CAPACITY_RULE = {
  provider: "antigravity",
  match: { status: 503, contains: "capacity" },
  action: "skip",
  sweep: true,
};

// The two canonical Antigravity capacity-503 error shapes.
// We probe the user's rules with these (via the REAL match logic) to decide whether a
// rule already covers capacity — rather than guessing from rule shape, which breaks
// with first-match ordering and partial matches (e.g. contains-only / status-only).
const ANTIGRAVITY_CAPACITY_PROBES = [
  { status: 503, errorKind: "http_503", text: "MODEL_CAPACITY_EXHAUSTED" },
  { status: 503, errorKind: "http_503", text: "No capacity available for model x" },
];

// Pure seed of the default Antigravity capacity rule into a settings object.
// Idempotent + respects the user's array-order intent. Runs only when skipRulesSeeded
// is falsy. For each canonical capacity-503 probe, we find the FIRST rule that fires:
//   - no rule fires        → that pattern is uncovered → append the default at the end
//   - a "retry" rule fires → user's deliberate choice; leave it, treat probe as handled
//   - a "skip" rule fires  → ensure sweep:true on it (full-pool resweep)
// Existing user rules keep their order/priority; the default is only appended when at
// least one capacity pattern is matched by no rule. Always stamps the flag.
// Shared by migration #2 and the legacy-JSON import so both upgrade paths agree (DRY).
export function seedAntigravityRule(data) {
  if (!data || typeof data !== "object") return data;
  if (data.skipRulesSeeded) return data;
  const rules = Array.isArray(data.providerSkipRules) ? data.providerSkipRules : [];

  let allCovered = true;
  for (const probe of ANTIGRAVITY_CAPACITY_PROBES) {
    const rule = findMatchingSkipRule("antigravity", probe, rules);
    if (rule == null) {
      allCovered = false; // this capacity pattern is caught by no rule → need default
    } else if (rule.action === "skip" && rule.sweep !== true) {
      rule.sweep = true; // full-pool resweep for the rule that catches it
    }
    // rule.action === "retry" → deliberate user choice; leave untouched.
  }
  if (!allCovered) {
    rules.push({ ...DEFAULT_ANTIGRAVITY_CAPACITY_RULE });
  }
  data.providerSkipRules = rules;
  data.skipRulesSeeded = true;
  return data;
}

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
  maxTransportAttempts: 2,
  providerSkipRules: [DEFAULT_ANTIGRAVITY_CAPACITY_RULE],
  skipRulesSeeded: true,
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
