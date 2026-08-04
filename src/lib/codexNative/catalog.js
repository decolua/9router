import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { getProviderConnections } from "@/lib/localDb.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

const CACHE_FILE = path.join(DATA_DIR, "codex-native", "catalog.json");
const UNSPECIFIED_VERSION = "__unspecified__";

if (!global.__codexNativeCatalogState) {
  global.__codexNativeCatalogState = {
    versions: new Map(),
    accounts: new Map(),
    refreshes: new Map(),
    diskLoaded: false,
  };
}
const state = global.__codexNativeCatalogState;

export function normalizeCodexClientVersion(value) {
  if (value == null || value === "") return null;
  const version = String(value);
  if (version.length > 128 || /[\u0000-\u001f\u007f]/.test(version)) {
    throw new Error("Invalid Codex client_version");
  }
  return version;
}

function versionKey(version) {
  return version ?? UNSPECIFIED_VERSION;
}

function accountKey(version, connectionId) {
  return `${versionKey(version)}\u0000${connectionId}`;
}

function accountId(connection) {
  return connection?.providerSpecificData?.workspaceId
    || connection?.providerSpecificData?.chatgptAccountId
    || connection?.providerSpecificData?.accountId
    || null;
}

function validModel(model) {
  return !!model
    && typeof model === "object"
    && typeof model.slug === "string"
    && model.slug.length > 0;
}

function proxyOptions(proxy) {
  return {
    connectionProxyEnabled: proxy.connectionProxyEnabled === true,
    connectionProxyUrl: proxy.connectionProxyUrl || "",
    connectionNoProxy: proxy.connectionNoProxy || "",
    vercelRelayUrl: proxy.vercelRelayUrl || "",
    strictProxy: proxy.strictProxy === true,
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])])
  );
}

export function hashCodexModelInfo(model) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(model))).digest("hex");
}

async function fetchConnectionCatalog(connection, clientVersion, cached) {
  const credentials = await checkAndRefreshToken("codex", {
    ...connection,
    connectionId: connection.id,
  });
  if (!credentials?.accessToken) throw new Error("Codex account has no access token");

  const headers = {
    accept: "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    originator: "codex_cli_rs",
  };
  const workspaceId = accountId(credentials);
  if (workspaceId) headers["chatgpt-account-id"] = workspaceId;
  if (cached?.upstreamEtag) headers["if-none-match"] = cached.upstreamEtag;

  const proxy = await resolveConnectionProxyConfig(credentials.providerSpecificData || {});
  const url = new URL(`${CODEX_NATIVE_CONFIG.upstreamHttpBaseUrl}/${CODEX_NATIVE_CONFIG.paths.models}`);
  if (clientVersion != null) url.searchParams.set("client_version", clientVersion);

  const response = await proxyAwareFetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(8_000),
  }, proxyOptions(proxy));

  if (response.status === 304 && cached) {
    return { ...cached, fetchedAt: Date.now(), notModified: true };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`Codex models ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const payload = await response.json();
  const models = (Array.isArray(payload?.models) ? payload.models : []).filter(validModel);
  if (models.length === 0) throw new Error("Codex returned an empty native model catalog");
  return {
    models,
    upstreamEtag: response.headers.get("x-models-etag") || response.headers.get("etag"),
    fetchedAt: Date.now(),
  };
}

export function selectCodexModelCohorts(results, connections) {
  const priorities = new Map(connections.map((connection) => [
    connection.id,
    connection.priority ?? 999,
  ]));
  const slugs = new Map();

  for (const result of results) {
    if (!result.ok) continue;
    for (const model of result.models) {
      const hash = hashCodexModelInfo(model);
      if (!slugs.has(model.slug)) slugs.set(model.slug, new Map());
      const cohorts = slugs.get(model.slug);
      if (!cohorts.has(hash)) cohorts.set(hash, { hash, model, connectionIds: [] });
      cohorts.get(hash).connectionIds.push(result.connectionId);
    }
  }

  const models = [];
  const eligibleConnectionIds = {};
  const cohortHashes = {};
  for (const [slug, cohorts] of slugs) {
    const selected = [...cohorts.values()].sort((left, right) => {
      const size = right.connectionIds.length - left.connectionIds.length;
      if (size !== 0) return size;
      const leftPriority = Math.min(...left.connectionIds.map((id) => priorities.get(id) ?? 999));
      const rightPriority = Math.min(...right.connectionIds.map((id) => priorities.get(id) ?? 999));
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.hash.localeCompare(right.hash);
    })[0];
    selected.connectionIds.sort((left, right) =>
      (priorities.get(left) ?? 999) - (priorities.get(right) ?? 999)
      || left.localeCompare(right)
    );
    models.push(selected.model);
    eligibleConnectionIds[slug] = selected.connectionIds;
    cohortHashes[slug] = selected.hash;
  }

  models.sort((left, right) =>
    (left.priority ?? 999) - (right.priority ?? 999)
    || left.slug.localeCompare(right.slug)
  );
  return { models, eligibleConnectionIds, cohortHashes };
}

function etagFor(models) {
  return `"${crypto.createHash("sha256").update(JSON.stringify(models)).digest("hex").slice(0, 32)}"`;
}

async function persistVersions() {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const versions = {};
  for (const [key, entry] of state.versions) {
    versions[key] = {
      clientVersion: entry.clientVersion,
      fetchedAt: entry.fetchedAt,
      models: entry.models,
      eligibleConnectionIds: entry.eligibleConnectionIds,
      cohortHashes: entry.cohortHashes,
    };
  }
  const tempPath = `${CACHE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify({ version: 2, versions }), { mode: 0o600 });
  await fs.rename(tempPath, CACHE_FILE);
}

async function loadDiskCache() {
  if (state.diskLoaded) return;
  state.diskLoaded = true;
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
    if (parsed?.version !== 2 || !parsed.versions) return;
    for (const [key, saved] of Object.entries(parsed.versions)) {
      const fetchedAt = Number(saved?.fetchedAt);
      if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > CODEX_NATIVE_CONFIG.catalogStaleMs) continue;
      const models = (saved.models || []).filter(validModel);
      if (models.length === 0) continue;
      state.versions.set(key, {
        clientVersion: saved.clientVersion ?? null,
        models,
        eligibleConnectionIds: saved.eligibleConnectionIds || {},
        cohortHashes: saved.cohortHashes || {},
        fetchedAt,
        etag: etagFor(models),
        source: "last-known-good",
        stale: true,
        accountCount: null,
        successfulAccountCount: null,
        warnings: [],
      });
    }
  } catch {
    // No last-known-good catalog yet.
  }
}

async function refreshCatalog(clientVersion) {
  const connections = await getProviderConnections({ provider: "codex", isActive: true });
  const settled = await Promise.all(connections.map(async (connection) => {
    const key = accountKey(clientVersion, connection.id);
    const cached = state.accounts.get(key);
    try {
      const result = await fetchConnectionCatalog(connection, clientVersion, cached);
      state.accounts.set(key, result);
      return { ok: true, connectionId: connection.id, ...result };
    } catch (error) {
      if (cached && Date.now() - cached.fetchedAt <= CODEX_NATIVE_CONFIG.catalogStaleMs) {
        return { ok: true, stale: true, connectionId: connection.id, ...cached, warning: error.message };
      }
      return { ok: false, connectionId: connection.id, error: error.message };
    }
  }));

  const usable = settled.filter((result) => result.ok);
  if (usable.length === 0) {
    const previous = state.versions.get(versionKey(clientVersion));
    if (previous && Date.now() - previous.fetchedAt <= CODEX_NATIVE_CONFIG.catalogStaleMs) {
      return { ...previous, source: "last-known-good", stale: true };
    }
    const error = new Error("No valid native Codex catalog is available");
    error.code = "codex_catalog_unavailable";
    throw error;
  }

  const merged = selectCodexModelCohorts(usable, connections);
  if (merged.models.length === 0) {
    const error = new Error("No native Codex model metadata cohort is available");
    error.code = "codex_catalog_unavailable";
    throw error;
  }

  const warnings = settled.flatMap((result) => {
    const message = result.error || result.warning;
    return message ? [{ connectionId: result.connectionId, message }] : [];
  });
  const entry = {
    ...merged,
    clientVersion,
    fetchedAt: Date.now(),
    source: usable.some((result) => !result.stale) ? "upstream" : "last-known-good",
    stale: usable.every((result) => result.stale),
    accountCount: connections.length,
    successfulAccountCount: usable.length,
    upstreamEtags: Object.fromEntries(usable.map((result) => [
      result.connectionId,
      result.upstreamEtag || null,
    ])),
    warnings,
  };
  entry.etag = etagFor(entry.models);
  state.versions.set(versionKey(clientVersion), entry);
  persistVersions().catch(() => {});
  return entry;
}

export async function getCodexNativeCatalog({ clientVersion, forceRefresh = false } = {}) {
  await loadDiskCache();
  const version = normalizeCodexClientVersion(clientVersion);
  const key = versionKey(version);
  const cached = state.versions.get(key);

  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CODEX_NATIVE_CONFIG.catalogTtlMs) {
    return cached;
  }
  if (!state.refreshes.has(key)) {
    state.refreshes.set(key, refreshCatalog(version).finally(() => state.refreshes.delete(key)));
  }
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt <= CODEX_NATIVE_CONFIG.catalogStaleMs) {
    state.refreshes.get(key).catch(() => {});
    return { ...cached, source: cached.source === "upstream" ? "cache" : cached.source };
  }
  return state.refreshes.get(key);
}

export async function getMostRecentCodexClientVersion() {
  await loadDiskCache();
  return [...state.versions.values()]
    .filter((entry) => entry.clientVersion)
    .sort((left, right) => right.fetchedAt - left.fetchedAt)[0]?.clientVersion || null;
}

export async function invalidateCodexNativeCatalog(connectionId, upstreamEtag, clientVersion = null) {
  const version = normalizeCodexClientVersion(clientVersion);
  const key = accountKey(version, connectionId);
  const cached = state.accounts.get(key);
  if (!cached || !upstreamEtag || cached.upstreamEtag !== upstreamEtag) {
    if (cached) cached.fetchedAt = 0;
    const merged = state.versions.get(versionKey(version));
    if (merged) merged.fetchedAt = 0;
    getCodexNativeCatalog({ clientVersion: version, forceRefresh: true }).catch(() => {});
  }
}

export function isCodexNativeModel(catalog, model) {
  return catalog?.models?.some((entry) => entry.slug === model) === true;
}

export function getCodexNativeDefaultModel(catalog) {
  return catalog?.models?.find((model) =>
    model?.supported_in_api !== false && model?.visibility !== "hide"
  )?.slug || null;
}
