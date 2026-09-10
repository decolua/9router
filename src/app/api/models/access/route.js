import { NextResponse } from "next/server";
import { PROVIDER_MODELS, COMBO_ALIAS } from "@/shared/constants/models";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import {
  getProviderConnections,
  getCustomModels,
  getDisabledModels,
  getProviderNodes,
  getCombos,
  disableModels,
  enableModels,
} from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

/**
 * Model access control for the final endpoint.
 *
 * Reports every model each connected provider can serve, split into allowed and
 * blocked, so the dashboard can gate what `/v1/models` exposes without having to
 * reproduce the endpoint's own filtering rules.
 */

// GET /api/models/access -> { providers: [{ alias, connections, total, allowed, blocked, models: [...] }] }
export async function GET() {
  try {
    const [connections, customModels, disabledByAlias, nodes, combos] = await Promise.all([
      getProviderConnections(),
      getCustomModels().catch(() => []),
      getDisabledModels().catch(() => ({})),
      getProviderNodes().catch(() => []),
      getCombos().catch(() => []),
    ]);

    // A user-defined OpenAI-compatible provider is stored under a generated id
    // ("openai-compatible-chat-<uuid>"), but routes under a short prefix and has
    // a name the user chose. Show those instead of the raw id.
    const nodeById = new Map();
    for (const n of nodes || []) {
      if (n?.id) nodeById.set(n.id, n);
    }
    // getProviderNodes() spreads the stored `data` blob onto the node, so the
    // routing prefix is node.prefix rather than node.data.prefix.
    const labelFor = (alias) => {
      const node = nodeById.get(alias);
      const def = AI_PROVIDERS[providerIdByAlias.get(alias) || alias] || AI_PROVIDERS[alias];
      return {
        name: node?.name || def?.name || alias,
        // What the model is actually called on /v1/models.
        routePrefix: node?.prefix || def?.alias || alias,
      };
    };

    // Only surface providers that actually have an account attached -- a model
    // from a provider with no connection can never be served anyway.
    const connectionCount = new Map();
    // AI_PROVIDERS is keyed by provider id, not alias (antigravity -> "ag"),
    // so keep the id around to resolve the display name.
    const providerIdByAlias = new Map();
    for (const c of connections || []) {
      const alias = getProviderAlias(c.provider) || c.provider;
      if (!alias) continue;
      connectionCount.set(alias, (connectionCount.get(alias) || 0) + 1);
      if (!providerIdByAlias.has(alias)) providerIdByAlias.set(alias, c.provider);
    }

    const byAlias = new Map();
    const push = (alias, model) => {
      if (!alias || !model?.id) return;
      if (!byAlias.has(alias)) byAlias.set(alias, new Map());
      const bucket = byAlias.get(alias);
      if (!bucket.has(model.id)) bucket.set(model.id, model);
    };

    for (const [alias, models] of Object.entries(PROVIDER_MODELS || {})) {
      if (!connectionCount.has(alias)) continue;
      for (const m of models || []) {
        push(alias, { id: m.id, name: m.name || m.id, kind: m.kind || m.type || "llm", custom: false });
      }
    }

    // Custom models are stored per alias and are servable just like static ones.
    for (const cm of customModels || []) {
      const alias = cm?.providerAlias;
      if (!alias || !connectionCount.has(alias)) continue;
      push(alias, { id: cm.id, name: cm.name || cm.id, kind: cm.type || "llm", custom: true });
    }

    const providers = [...byAlias.entries()]
      .map(([alias, bucket]) => {
        const blockedIds = Array.isArray(disabledByAlias[alias]) ? disabledByAlias[alias] : [];
        const models = [...bucket.values()]
          .map((m) => ({ ...m, blocked: blockedIds.includes(m.id) }))
          .sort((a, b) => a.id.localeCompare(b.id));
        return {
          alias,
          ...labelFor(alias),
          connections: connectionCount.get(alias) || 0,
          total: models.length,
          blocked: models.filter((m) => m.blocked).length,
          allowed: models.filter((m) => !m.blocked).length,
          models,
        };
      })
      .sort((a, b) => (a.name || a.alias).localeCompare(b.name || b.alias));

    // Combos are routable names too (id === combo.name, no provider prefix) and
    // /v1/models gates them on the same disabled list under COMBO_ALIAS.
    const comboBlocked = Array.isArray(disabledByAlias[COMBO_ALIAS]) ? disabledByAlias[COMBO_ALIAS] : [];
    const comboModels = (combos || [])
      .filter((c) => c?.name)
      .map((c) => ({
        id: c.name,
        name: c.name,
        kind: c.kind || "llm",
        custom: false,
        combo: true,
        blocked: comboBlocked.includes(c.name),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (comboModels.length) {
      providers.unshift({
        alias: COMBO_ALIAS,
        name: "Combos",
        routePrefix: "",
        connections: comboModels.length,
        total: comboModels.length,
        blocked: comboModels.filter((m) => m.blocked).length,
        allowed: comboModels.filter((m) => !m.blocked).length,
        models: comboModels,
      });
    }

    const totals = providers.reduce(
      (acc, p) => ({
        total: acc.total + p.total,
        allowed: acc.allowed + p.allowed,
        blocked: acc.blocked + p.blocked,
      }),
      { total: 0, allowed: 0, blocked: 0 },
    );

    return NextResponse.json({ providers, totals });
  } catch (error) {
    console.log("Error building model access list:", error);
    return NextResponse.json({ error: "Failed to build model access list" }, { status: 500 });
  }
}

// POST /api/models/access  body: { providerAlias, ids: [...], action: "block" | "allow" }
export async function POST(request) {
  try {
    const { providerAlias, ids, action } = await request.json();
    if (!providerAlias || !Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ error: "providerAlias and non-empty ids[] required" }, { status: 400 });
    }
    if (action !== "block" && action !== "allow") {
      return NextResponse.json({ error: 'action must be "block" or "allow"' }, { status: 400 });
    }

    if (action === "block") await disableModels(providerAlias, ids);
    else await enableModels(providerAlias, ids);

    return NextResponse.json({ success: true, action, count: ids.length });
  } catch (error) {
    console.log("Error updating model access:", error);
    return NextResponse.json({ error: "Failed to update model access" }, { status: 500 });
  }
}
