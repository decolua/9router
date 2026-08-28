import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import {
  getCapabilitiesForModel,
  getStaticCapabilitiesForModel,
  setContextWindowOverrides,
} from "open-sse/providers/capabilities.js";
import { AI_MODELS } from "@/shared/constants/models.js";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import REGISTRY from "open-sse/providers/registry/index.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store" };

function sanitizeContextWindow(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// Map an output alias (/v1/models id prefix) back to the AI_MODELS provider
// key. Registry uiAlias/aliases count too (ocg -> opencode-go). Unknown aliases
// (custom compatible connections like a user-set prefix "bai") become their
// own provider group so every /v1/models prefix shows on the page.
function outputAliasToModelKey(alias) {
  for (const entry of REGISTRY) {
    if (entry.alias === alias || entry.id === alias || entry.uiAlias === alias) {
      return entry.alias || entry.id;
    }
    if (Array.isArray(entry.aliases) && entry.aliases.includes(alias)) {
      return entry.alias || entry.id;
    }
  }
  return alias;
}

// Provider display name resolution: explicit AI_PROVIDERS entry → custom node
// name (matched by the v1 id prefix the node configures, e.g. prefix "bai" →
// user-named "b-ai") → registry display name → the key itself.
function providerDisplayName(key, alias, prefixNames) {
  return (
    AI_PROVIDERS[key]?.name ||
    prefixNames.get(alias || key) ||
    REGISTRY.find((r) => r.alias === key || r.id === key)?.display?.name ||
    key
  );
}

// Refresh the in-memory override map from persisted settings.
async function reloadOverrides() {
  const settings = await getSettings();
  setContextWindowOverrides(settings.contextWindowOverrides || {});
  return settings.contextWindowOverrides || {};
}

// GET /api/model-context - Overrides + every registered model with static/effective window
export async function GET() {
  try {
    const settings = await getSettings();
    const overrides = settings.contextWindowOverrides || {};

    // A provider counts as "active" when it has at least one enabled connection,
    // mirroring the Providers page semantics (connection.isActive). Connections
    // key by registry id (e.g. "antigravity") while AI_MODELS keys by alias
    // (e.g. "ag"), so resolve the alias back to the registry id before matching.
    const connections = await getProviderConnections();

    // Custom compatible connections key by their providerNodes id
    // ("anthropic-compatible-<uuid>"), while model rows key by the node's
    // /v1 prefix ("bai"). Build both node-id → prefix and prefix → display
    // name maps up front so the folds below can land on model-row keys.
    const nodeIdToPrefix = new Map();
    const prefixNames = new Map();
    try {
      for (const n of await getProviderNodes()) {
        if (n.id && n.prefix) nodeIdToPrefix.set(n.id, n.prefix);
        if (n.prefix && n.name) prefixNames.set(n.prefix, n.name);
      }
    } catch {}

    const activeProviderIds = new Set(
      connections.filter((c) => c.isActive === true).map((c) => c.provider)
    );

    // Per-provider connection counts (any enablement). Providers registered but
    // never connected (0) carry the most likely-stale static windows.
    // Connections key by registry id — or a custom node id — while model rows
    // key by AI_MODELS key / node prefix, so resolve through both maps.
    const connCountByProvider = {};
    for (const c of connections) {
      const reg = outputAliasToModelKey(c.provider);
      const k =
        reg === c.provider && nodeIdToPrefix.has(c.provider)
          ? nodeIdToPrefix.get(c.provider)
          : reg;
      connCountByProvider[k] = (connCountByProvider[k] || 0) + 1;
    }

    // The /v1/models list is the "default visible" set, grouped per provider
    // alias. Anything not returned there is hidden by default on the page.
    // /v1/models also carries dynamic models (connection enabledModels / live
    // catalogs) that never exist in the static AI_MODELS table — surface those
    // as their own entries so every /v1/models provider prefix shows a group.
    let v1ByAlias = new Map();
    const v1Entries = [];
    try {
      const v1Models = await buildModelsList(["llm"]);
      for (const m of v1Models) {
        const id = m?.id;
        if (typeof id !== "string") continue;
        const idx = id.indexOf("/");
        if (idx <= 0) continue;
        const alias = id.slice(0, idx);
        const modelId = id.slice(idx + 1);
        if (!v1ByAlias.has(alias)) v1ByAlias.set(alias, new Set());
        v1ByAlias.get(alias).add(modelId);
        const key = outputAliasToModelKey(alias);
        // context_length from /v1/models already has overrides applied — keep
        // it as the effective window, and resolve the static default separately
        // so overrides on dynamic models still show the static → effective delta.
        const staticCaps = getStaticCapabilitiesForModel(key, modelId);
        v1Entries.push({
          provider: key,
          providerName: providerDisplayName(key, alias, prefixNames),
          providerActive: true,
          providerConnections: connCountByProvider[key] || 0,
          model: modelId,
          name: m.name || modelId,
          staticContextWindow: staticCaps.contextWindow,
          contextWindow: Number.isFinite(m.context_length) ? m.context_length : null,
          defaultVisible: true,
        });
      }
    } catch (e) {
      console.log("Could not build v1 models for default visibility:", e);
    }

    const staticEntries = AI_MODELS.map((m) => {
      const staticCaps = getStaticCapabilitiesForModel(m.provider, m.model);
      const caps = getCapabilitiesForModel(m.provider, m.model);
      const providerActive =
        activeProviderIds.has(m.provider) ||
        activeProviderIds.has(resolveProviderId(m.provider));
      // defaultVisible: the model appears in /v1/models under this provider's
      // alias (registry id, alias, uiAlias, or aliases[] all count).
      const p = AI_PROVIDERS[m.provider];
      const aliases = new Set([m.provider]);
      if (p) {
        if (p.alias) aliases.add(p.alias);
        if (p.uiAlias) aliases.add(p.uiAlias);
        if (Array.isArray(p.aliases)) p.aliases.forEach((a) => aliases.add(a));
      }
      let defaultVisible = false;
      for (const alias of aliases) {
        const ids = v1ByAlias.get(alias);
        if (ids && ids.has(m.model)) { defaultVisible = true; break; }
      }
      return {
        provider: m.provider,
        providerName: providerDisplayName(m.provider, m.provider, prefixNames),
        providerActive,
        providerConnections: connCountByProvider[m.provider] || 0,
        model: m.model,
        name: m.name,
        staticContextWindow: staticCaps.contextWindow,
        contextWindow: caps.contextWindow,
        defaultVisible,
      };
    });

    // Merge: static entries first, v1 entries fill in models the registry never
    // declared (dynamic enabled/live models). Same provider/model dedupes.
    const merged = new Map();
    for (const e of staticEntries) merged.set(`${e.provider}/${e.model}`, e);
    for (const e of v1Entries) {
      const k = `${e.provider}/${e.model}`;
      const existing = merged.get(k);
      if (existing) {
        existing.defaultVisible = true;
        existing.providerActive = true;
        if (existing.contextWindow == null) existing.contextWindow = e.contextWindow;
      } else {
        merged.set(k, e);
      }
    }
    const models = [...merged.values()];

    return NextResponse.json(
      { overrides, activeProviders: [...activeProviderIds], models },
      { headers: HEADERS }
    );
  } catch (error) {
    console.log("Error fetching model context:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/model-context - { key, contextWindow } upsert one override
export async function PUT(request) {
  try {
    const { key, contextWindow } = await request.json();
    if (!key || typeof key !== "string" || !key.trim()) {
      return NextResponse.json({ error: "key required" }, { status: 400 });
    }
    const window = sanitizeContextWindow(contextWindow);
    if (window === null) {
      return NextResponse.json({ error: "contextWindow must be a positive integer" }, { status: 400 });
    }

    const settings = await getSettings();
    const overrides = { ...(settings.contextWindowOverrides || {}), [key.trim()]: window };
    await updateSettings({ contextWindowOverrides: overrides });
    await reloadOverrides();
    return NextResponse.json({ success: true, overrides });
  } catch (error) {
    console.log("Error setting model context:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/model-context?key=xxx - remove one override
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "key required" }, { status: 400 });
    }

    const settings = await getSettings();
    const overrides = { ...(settings.contextWindowOverrides || {}) };
    delete overrides[key];
    await updateSettings({ contextWindowOverrides: overrides });
    await reloadOverrides();
    return NextResponse.json({ success: true, overrides });
  } catch (error) {
    console.log("Error deleting model context:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/model-context - bulk apply: { set: [{key, contextWindow}], deleteKeys: [...] }
// One settings write + one reloadOverrides for the whole batch (vs N round-trips
// each reloading the engine map). Invalid items are skipped and counted.
export async function POST(request) {
  try {
    const { set, deleteKeys } = await request.json();
    if (!Array.isArray(set) && !Array.isArray(deleteKeys)) {
      return NextResponse.json({ error: "set[] or deleteKeys[] required" }, { status: 400 });
    }

    const settings = await getSettings();
    const overrides = { ...(settings.contextWindowOverrides || {}) };
    let nSet = 0;
    let nDel = 0;
    for (const item of Array.isArray(set) ? set : []) {
      const key = typeof item?.key === "string" ? item.key.trim() : "";
      const window = sanitizeContextWindow(item?.contextWindow);
      if (!key || window === null) continue;
      overrides[key] = window;
      nSet++;
    }
    for (const k of Array.isArray(deleteKeys) ? deleteKeys : []) {
      if (typeof k !== "string" || !k) continue;
      if (k in overrides) nDel++;
      delete overrides[k];
    }

    await updateSettings({ contextWindowOverrides: overrides });
    await reloadOverrides();
    return NextResponse.json({ success: true, nSet, nDel, overrides });
  } catch (error) {
    console.log("Error bulk updating model context:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
