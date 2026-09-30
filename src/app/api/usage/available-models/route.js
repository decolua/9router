import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/dashboardPermissions";
import { filterModelsByAllowedModels, worstModelStatus } from "@/lib/usage/availableModels.js";
import { AI_MODELS } from "@/shared/constants/config";
import { FREE_PROVIDERS, getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import { getDisabledModels } from "@/lib/disabledModelsDb";

export const dynamic = "force-dynamic";

function isDisabled(disabled, provider, model) {
  const alias = getProviderAlias(provider) || provider;
  const list = disabled[alias] || disabled[provider] || [];
  return Array.isArray(list) && list.includes(model);
}

// A connection locked for every model it serves reports "__all"; anything
// else names the bare model id after `modelLock_`.
function activeLocks(connection) {
  const now = Date.now();
  const out = [];
  for (const [key, value] of Object.entries(connection || {})) {
    if (!key.startsWith("modelLock_") || !value) continue;
    if (new Date(value).getTime() <= now) continue;
    out.push(key.slice("modelLock_".length) || "__all");
  }
  return out;
}

// GET /api/usage/available-models — read-only catalog for the signing-in key.
// A key session that holds only viewUsage cannot open /api/models or
// /api/combos, so this endpoint rebuilds that same catalog server side and
// narrows it to the session's allowedModels before answering. No writes.
export async function GET() {
  try {
    const ctx = await getSessionContext();
    if (!ctx.session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allowedModelsRaw = ctx.allowedModels || "*";
    const isApiKey = ctx.session.role === "apikey";

    const [modelAliases, disabled, customModels, combos, connections, studioModels] = await Promise.all([
      import("@/models").then((m) => m.getModelAliases().catch(() => ({}))),
      getDisabledModels().catch(() => ({})),
      import("@/lib/localDb").then((m) => m.getCustomModels().catch(() => [])),
      import("@/lib/localDb").then((m) => m.getCombos().catch(() => [])),
      import("@/lib/localDb").then((m) => m.getProviderConnections().catch(() => [])),
      import("@/lib/db/repos/modelEditorRepo.js").then((m) => m.getStudioModels().catch(() => [])),
    ]);

    const entries = [];

    for (const m of AI_MODELS || []) {
      if (!m?.provider || !m?.model) continue;
      if (isDisabled(disabled, m.provider, m.model)) continue;
      const fullModel = `${m.provider}/${m.model}`;
      const providerAlias = getProviderAlias(m.provider) || m.provider;
      entries.push({
        name: m.name || m.model,
        model: m.model,
        provider: providerAlias,
        fullModel,
        routedModel: `${providerAlias}/${m.model}`,
        alias: (modelAliases || {})[fullModel] || m.model,
        origin: "provider",
      });
    }

    const seenFull = new Set(entries.map((e) => e.fullModel));
    for (const m of customModels || []) {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") continue;
      const fullModel = `${m.providerAlias}/${m.id}`;
      if (seenFull.has(fullModel)) continue;
      seenFull.add(fullModel);
      entries.push({
        name: m.name || m.id,
        model: m.id,
        provider: m.providerAlias,
        fullModel,
        routedModel: fullModel,
        alias: (modelAliases || {})[fullModel] || m.id,
        origin: "custom",
      });
    }

    for (const s of studioModels || []) {
      if (!s?.callName || !s?.provider || !s?.model) continue;
      entries.push({
        name: s.displayName || s.callName,
        model: s.callName,
        provider: s.provider,
        fullModel: `${s.provider}/${s.callName}`,
        routedModel: s.callName,
        alias: s.callName,
        origin: "studio",
      });
    }

    const comboMembers = {};
    for (const combo of combos || []) {
      if (!combo?.name) continue;
      const members = Array.isArray(combo.models) ? combo.models : [];
      comboMembers[combo.name] = members;
      entries.push({
        name: combo.name,
        model: combo.name,
        provider: "combo",
        fullModel: combo.name,
        routedModel: combo.name,
        alias: combo.name,
        origin: "combo",
      });
    }

    // Per-provider health from live connections: a provider with no active
    // connection is reported unavailable, one whose models are all locked
    // cooling down. Combos roll up the worst of their members.
    const activeByProvider = new Map();
    const locksByProvider = new Map();
    for (const conn of connections || []) {
      if (!conn?.provider) continue;
      if (conn.isActive === false) continue;
      const key = String(conn.provider).toLowerCase();
      const rec = activeByProvider.get(key) || { active: 0, unavailable: 0 };
      if (conn.testStatus === "unavailable") rec.unavailable += 1;
      else rec.active += 1;
      activeByProvider.set(key, rec);
      for (const lock of activeLocks(conn)) {
        const arr = locksByProvider.get(key) || [];
        arr.push(String(lock).toLowerCase());
        locksByProvider.set(key, arr);
      }
    }

    // Connection rows are keyed by provider id while catalog entries carry the
    // alias, so compare both spellings before calling a provider unknown.
    const providerKeys = (provider) => {
      const keys = new Set();
      for (const cand of [provider, getProviderAlias(provider), resolveProviderId(provider)]) {
        const s = String(cand || "").trim().toLowerCase();
        if (s) keys.add(s);
      }
      return [...keys];
    };

    const providerStatus = (provider) => {
      let found = false;
      let active = 0;
      for (const key of providerKeys(provider)) {
        const rec = activeByProvider.get(key);
        if (!rec) continue;
        found = true;
        active += rec.active;
      }
      if (!found) {
        // Credential-free providers serve without a connection row.
        try {
          const id = resolveProviderId(provider);
          if (id && FREE_PROVIDERS[id]?.noAuth) return "ready";
        } catch {
          /* fall through */
        }
        return "ready";
      }
      return active > 0 ? "ready" : "unavailable";
    };

    const modelLockStatus = (provider, bareModel) => {
      const locks = [];
      for (const key of providerKeys(provider)) {
        locks.push(...(locksByProvider.get(key) || []));
      }
      if (locks.length === 0) return "ready";
      const bare = String(bareModel || "").toLowerCase();
      if (locks.includes("__all")) return "cooldown";
      if (bare && locks.includes(bare)) return "cooldown";
      return "limited";
    };

    const memberStatus = (member, seen) => {
      const s = String(member || "").trim();
      if (!s) return "ready";
      if (comboMembers[s]) {
        if (seen.has(s)) return "ready";
        seen.add(s);
        const nested = comboMembers[s].map((m) => memberStatus(m, seen));
        seen.delete(s);
        return nested.length ? worstModelStatus(nested) : "ready";
      }
      const slash = s.indexOf("/");
      if (slash > 0) {
        const provider = s.slice(0, slash);
        const bare = s.slice(slash + 1);
        return worstModelStatus([providerStatus(provider), modelLockStatus(provider, bare)]);
      }
      return "ready";
    };

    const withStatus = entries.map((entry) => {
      let status = "ready";
      if (entry.origin === "combo") {
        const members = comboMembers[entry.model] || [];
        status = members.length
          ? worstModelStatus(members.map((m) => memberStatus(m, new Set([entry.model]))))
          : "ready";
      } else {
        status = worstModelStatus([
          providerStatus(entry.provider),
          modelLockStatus(entry.provider, entry.model),
        ]);
      }
      return { ...entry, status };
    });

    const models = filterModelsByAllowedModels(withStatus, allowedModelsRaw);
    models.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return NextResponse.json(
      {
        models,
        total: withStatus.length,
        keyName: isApiKey ? ctx.session.keyName || "API Key" : null,
        tokenLimit: isApiKey ? ctx.session.tokenLimit || 0 : 0,
        allowedModels: allowedModelsRaw,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[API] Failed to get available models:", error);
    return NextResponse.json({ error: "Failed to fetch available models" }, { status: 500 });
  }
}
