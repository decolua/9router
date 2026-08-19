import { NextResponse } from "next/server";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import {
  getProviderConnections,
  getCustomModels,
  getDisabledModels,
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
    const [connections, customModels, disabledByAlias] = await Promise.all([
      getProviderConnections(),
      getCustomModels().catch(() => []),
      getDisabledModels().catch(() => ({})),
    ]);

    // Only surface providers that actually have an account attached -- a model
    // from a provider with no connection can never be served anyway.
    const connectionCount = new Map();
    for (const c of connections || []) {
      const alias = getProviderAlias(c.provider) || c.provider;
      if (!alias) continue;
      connectionCount.set(alias, (connectionCount.get(alias) || 0) + 1);
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
          connections: connectionCount.get(alias) || 0,
          total: models.length,
          blocked: models.filter((m) => m.blocked).length,
          allowed: models.filter((m) => !m.blocked).length,
          models,
        };
      })
      .sort((a, b) => a.alias.localeCompare(b.alias));

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
