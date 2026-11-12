// Live Codex model catalog, in the contract the Codex CLI parses — the same
// {"models":[...]} shape codex-lb serves at /backend-api/codex/models. Entries
// are passed through verbatim because the client gates on fields (tool_mode,
// use_responses_lite, supported_reasoning_levels, available_in_plans) that a
// normalized {id,name} list throws away.
//
// Upstream catalogs are per-plan, so every active connection is fetched and the
// results merged. codex-lb drops to a bundled bootstrap when its last account
// dies, which silently downgrades a client's picker to older models; here the
// last successful merge is persisted and a fetch that reaches fewer plans cannot
// shrink it below what this router still advertises.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { refreshCodexToken } from "./tokenRefresh.js";
import codexProvider from "../providers/registry/codex.js";

export const CODEX_CATALOG_FILE = path.join(DATA_DIR, "codex-model-catalog.json");
const SNAPSHOT_VERSION = 1;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

const CLI_VERSION = codexProvider.transport.cliVersion;
export const CODEX_CATALOG_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CLI_VERSION}`;

// Upstream slugs this router can still route, including the [1m]/-review
// variants' base ids. Used only to decide which snapshot entries survive a
// narrower live fetch.
const ROUTABLE_SLUGS = new Set(
  codexProvider.models.map((m) => m.upstreamModelId || m.id),
);

let memoryCache = null;
let inFlight = null;
let snapshotCache = null;
let snapshotMtime = -1;

function accountIdOf(conn) {
  const psd = conn?.providerSpecificData || {};
  return psd.workspaceId || psd.chatgptAccountId || psd.accountId || null;
}

function readSnapshot() {
  let mtime;
  try {
    mtime = fs.statSync(CODEX_CATALOG_FILE).mtimeMs;
  } catch {
    snapshotCache = null;
    snapshotMtime = -1;
    return null;
  }
  if (mtime === snapshotMtime) return snapshotCache;
  snapshotMtime = mtime;
  try {
    const parsed = JSON.parse(fs.readFileSync(CODEX_CATALOG_FILE, "utf8"));
    snapshotCache = Array.isArray(parsed?.models) && parsed.models.length
      ? { models: parsed.models, fetchedAt: parsed.fetchedAt || null }
      : null;
  } catch {
    snapshotCache = null;
  }
  return snapshotCache;
}

function writeSnapshot(models) {
  const fetchedAt = new Date().toISOString();
  const tmp = `${CODEX_CATALOG_FILE}.tmp`;
  fs.mkdirSync(path.dirname(CODEX_CATALOG_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ version: SNAPSHOT_VERSION, fetchedAt, models }), "utf8");
  fs.renameSync(tmp, CODEX_CATALOG_FILE);
  snapshotMtime = -1;
  return fetchedAt;
}

function planCount(entry) {
  return Array.isArray(entry?.available_in_plans) ? entry.available_in_plans.length : 0;
}

// Insertion order is upstream's picker order; keep it. For a slug seen on more
// than one plan the broader entry wins — a team catalog carries plans and
// capability flags the free entry omits.
export function mergeCodexCatalogs(lists) {
  const bySlug = new Map();
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) {
      const slug = entry?.slug;
      if (typeof slug !== "string" || !slug) continue;
      const prev = bySlug.get(slug);
      if (!prev || planCount(entry) > planCount(prev)) bySlug.set(slug, entry);
    }
  }
  return [...bySlug.values()];
}

/**
 * Merge the live upstream catalog with the provider registry list.
 *
 * The registry carries the variants upstream never advertises — the "[1m]"
 * extended-context twins and the "-review" quota family — so it is kept in
 * full. For every id both sides know, the live entry wins: upstream is the
 * authority on the context window, and a stale registry value would overstate
 * or understate it.
 *
 * @param {object[]} live - entries from resolveCodexCatalog
 * @param {object[]} registry - PROVIDER_MODELS entries ({ id, name, kind, upstreamModelId })
 * @returns {object[]} merged entries for the model list
 */
export function mergeCodexRegistryModels(live, registry) {
  const liveBySlug = new Map();
  for (const entry of Array.isArray(live) ? live : []) {
    if (typeof entry?.slug === "string" && entry.slug) liveBySlug.set(entry.slug, entry);
  }

  const merged = [];
  const seen = new Set();

  for (const entry of Array.isArray(registry) ? registry : []) {
    if (!entry?.id) continue;
    const liveEntry = liveBySlug.get(entry.id) || liveBySlug.get(entry.upstreamModelId);
    seen.add(entry.id);
    if (!liveEntry) {
      merged.push({ ...entry });
      continue;
    }
    // A registry entry whose upstreamModelId differs from its id is a variant:
    // the "[1m]" extended-context twins and the "-review" quota family. The
    // live context window describes the base model, so applying it to the
    // variant would shrink the extended window back to the base one. Variants
    // keep their registry capabilities.
    const isVariant = Boolean(entry.upstreamModelId) && entry.upstreamModelId !== entry.id;
    const contextWindow = isVariant ? undefined : Number(liveEntry.context_window);
    // Image and transcription entries carry a capability *list* (["text2img",
    // "edit"]); chat entries carry an object. The merge does not fabricate
    // capabilities — the caller composes the full set and overrides the window.
    const capabilities = entry.capabilities && !Array.isArray(entry.capabilities)
      ? { ...entry.capabilities }
      : entry.capabilities;
    merged.push({
      ...entry,
      capabilities,
      upstreamContextWindow: Number.isFinite(contextWindow) ? contextWindow : undefined,
      upstreamMaxContextWindow: Number(liveEntry.max_context_window) || undefined,
    });
  }

  // Models upstream advertises that the registry has never heard of.
  for (const [slug, liveEntry] of liveBySlug) {
    if (seen.has(slug)) continue;
    const contextWindow = Number(liveEntry.context_window);
    merged.push({
      id: slug,
      name: liveEntry.display_name || slug,
      upstreamContextWindow: Number.isFinite(contextWindow) ? contextWindow : undefined,
      upstreamMaxContextWindow: Number(liveEntry.max_context_window) || undefined,
    });
  }

  return merged;
}

async function fetchConnectionCatalog(conn, { onCredentialsRefreshed, proxyOptions, log }) {
  if (!conn?.accessToken) return { error: "no access token" };

  const accountId = accountIdOf(conn);
  const headers = {
    Accept: "*/*",
    originator: "codex_cli_rs",
    "User-Agent": `codex_cli_rs/${CLI_VERSION}`,
    version: CLI_VERSION,
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  const request = (token) => proxyAwareFetch(CODEX_CATALOG_URL, {
    method: "GET",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }, proxyOptions);

  let response = await request(conn.accessToken);
  // Refresh only after a rejection. Codex rotates the refresh token on every
  // use, so refreshing proactively here can revoke the whole OpenAI session.
  if ((response.status === 401 || response.status === 403) && conn.refreshToken) {
    const refreshed = await refreshCodexToken(conn.refreshToken, log);
    if (refreshed?.accessToken) {
      await onCredentialsRefreshed?.(conn, refreshed);
      response = await request(refreshed.accessToken);
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { error: `HTTP ${response.status}: ${text.slice(0, 200)}`, status: response.status };
  }

  const data = await response.json();
  if (!Array.isArray(data?.models)) return { error: "upstream response has no models array" };
  return { models: data.models };
}

/**
 * Resolve the merged Codex catalog.
 * @param {object[]} connections - active Codex connections (DB records)
 * @param {Function} [onCredentialsRefreshed] - (conn, refreshed) => persist new tokens
 * @param {Function} [proxyOptionsFor] - (conn) => proxy options
 * @param {boolean} [forceRefresh] - bypass the TTL cache
 * @returns {Promise<{models: object[], fetchedAt: string|null, source: "live"|"snapshot"|"unavailable", warning?: string}>}
 */
export async function resolveCodexCatalog({
  connections,
  onCredentialsRefreshed,
  proxyOptionsFor,
  forceRefresh = false,
  log,
}) {
  if (!forceRefresh && memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const lists = [];
    const errors = [];
    for (const conn of Array.isArray(connections) ? connections : []) {
      try {
        const result = await fetchConnectionCatalog(conn, {
          onCredentialsRefreshed,
          proxyOptions: await proxyOptionsFor?.(conn) || null,
          log,
        });
        if (result.models?.length) lists.push(result.models);
        else if (result.error) errors.push(result.error);
      } catch (err) {
        errors.push(err?.message || String(err));
      }
    }

    const snapshot = readSnapshot();
    const live = mergeCodexCatalogs(lists);

    if (live.length) {
      const liveSlugs = new Set(live.map((m) => m.slug));
      const retained = (snapshot?.models || []).filter(
        (m) => typeof m?.slug === "string" && !liveSlugs.has(m.slug) && ROUTABLE_SLUGS.has(m.slug),
      );
      const models = [...live, ...retained];
      let fetchedAt = snapshot?.fetchedAt || null;
      let warning = errors.length ? errors.join("; ") : undefined;
      try {
        fetchedAt = writeSnapshot(models);
      } catch (err) {
        warning = [warning, `catalog snapshot not written: ${err?.message || err}`].filter(Boolean).join("; ");
      }
      memoryCache = { expiresAt: Date.now() + CACHE_TTL_MS, models, fetchedAt, source: "live", warning };
      return memoryCache;
    }

    memoryCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      models: snapshot?.models || [],
      fetchedAt: snapshot?.fetchedAt || null,
      source: snapshot ? "snapshot" : "unavailable",
      warning: errors.length ? errors.join("; ") : "no active Codex connection with an access token",
    };
    return memoryCache;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function clearCodexCatalogCache() {
  memoryCache = null;
  snapshotMtime = -1;
}