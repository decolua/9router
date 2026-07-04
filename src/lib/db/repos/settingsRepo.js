import { qGet, qRun } from "../query.js";

import { getAdapter } from "../driver.js";

import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

import { parseEncryptedJson, stringifyEncryptedJson } from "../helpers/encryptedJsonCol.js";

import { isMasterKeyConfigured } from "../../crypto/masterKey.js";

import { getDefaultOrgId } from "./organizationsRepo.js";

import { getRuntimeOrgId } from "../../auth/runtimeUserContext.js";



function readSettingsData(raw) {

  return isMasterKeyConfigured() ? parseEncryptedJson(raw, {}) : parseJson(raw, {});

}

function writeSettingsData(value) {

  return isMasterKeyConfigured() ? stringifyEncryptedJson(value) : stringifyJson(value);

}



const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";



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

  prefixCacheEnabled: true,

  cavemanEnabled: false,

  cavemanLevel: "full",

  compactPoliciesEnabled: false,

  multiUserEnabled: true,

  signupMode: "invite",

};



async function resolveOrgId(explicitOrgId) {

  if (explicitOrgId) return explicitOrgId;

  const runtime = getRuntimeOrgId();

  if (runtime) return runtime;

  return getDefaultOrgId();

}



async function readRaw(orgId) {

  const resolved = await resolveOrgId(orgId);

  if (!resolved) return {};

  const db = await getAdapter();

  const row = await qGet(db, `SELECT data FROM settings WHERE orgId = ?`, [resolved]);

  return row ? readSettingsData(row.data) : {};

}



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



export async function getSettings(orgId) {

  const raw = await readRaw(orgId);

  return mergeWithDefaults(raw);

}



const SETTINGS_UPSERT_SQL = `INSERT INTO settings(orgId, data) VALUES(?, ?) ON CONFLICT(orgId) DO UPDATE SET data = excluded.data`;



export async function updateSettings(updates, orgId) {

  const db = await getAdapter();

  const resolved = await resolveOrgId(orgId);

  if (!resolved) throw new Error("Organization not configured");

  let next;



  if (db.dialect === "postgres") {

    await db.transaction(async (tx) => {

      const row = await tx.get(`SELECT data FROM settings WHERE orgId = ?`, [resolved]);

      const current = row ? readSettingsData(row.data) : {};

      next = { ...current, ...updates };

      await tx.run(SETTINGS_UPSERT_SQL, [resolved, writeSettingsData(next)]);

    });

  } else {

    db.transaction(() => {

      const row = db.get(`SELECT data FROM settings WHERE orgId = ?`, [resolved]);

      const current = row ? readSettingsData(row.data) : {};

      next = { ...current, ...updates };

      db.run(SETTINGS_UPSERT_SQL, [resolved, writeSettingsData(next)]);

    });

  }



  return mergeWithDefaults(next);

}



export async function createOrgSettings(orgId, initial = {}) {

  const db = await getAdapter();

  const payload = mergeWithDefaults(initial);

  await qRun(db, SETTINGS_UPSERT_SQL, [orgId, writeSettingsData(payload)]);

  return payload;

}



export async function isCloudEnabled(orgId) {

  const settings = await getSettings(orgId);

  return settings.cloudEnabled === true;

}



export async function getCloudUrl(orgId) {

  const settings = await getSettings(orgId);

  return (

    settings.cloudUrl ||

    process.env.CLOUD_URL ||

    process.env.NEXT_PUBLIC_CLOUD_URL ||

    ""

  );

}



export async function exportSettings(orgId) {

  return await readRaw(orgId);

}

