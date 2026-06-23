import type { DbAdapter } from "../driver.js";
import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {} as Record<string, unknown>,
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {} as Record<string, unknown>,
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  enableObservability: true,
  logToolSources: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {} as Record<string, unknown>,
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: "http://localhost:8787",
  headroomSource: "custom",
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  modelFallbacks: {} as Record<string, unknown>,
};

export type Settings = typeof DEFAULT_SETTINGS & Record<string, unknown>;

async function readRaw(): Promise<Record<string, unknown>> {
  const db: DbAdapter = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  if (!row || !("data" in row) || typeof row["data"] !== "string") return {};
  return (parseJson(row["data"], {}) as Record<string, unknown>) ?? {};
}

function mergeWithDefaults(raw: Record<string, unknown>): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) } as Settings;
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged["outboundProxyUrl"] === "string" &&
        (merged["outboundProxyUrl"] as string).trim()
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

export async function updateSettings(updates: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  let next: Record<string, unknown> = {};
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current =
      row && "data" in row && typeof row["data"] === "string"
        ? ((parseJson(row["data"], {}) as Record<string, unknown>) ?? {})
        : {};
    next = { ...current, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next as JsonValue)],
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
    (settings["cloudUrl"] as string | undefined) ||
    process.env["CLOUD_URL"] ||
    process.env["NEXT_PUBLIC_CLOUD_URL"] ||
    ""
  );
}

export async function exportSettings() {
  return readRaw();
}
