import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels, getProviderNodes, getProviderConnections } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias, ALIAS_TO_ID } from "@/shared/constants/providers";
import { resolveProviderPrefix } from "@/shared/utils/providerPrefix";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    // Custom providers (openai-/anthropic-compatible, custom embedding) are
    // provider nodes whose ID is a UUID-bearing string. They are addressed by
    // the prefix the user configured, not by that ID — publishing the ID makes
    // the model ID unusable in a client. /v1/models already resolves this; keep
    // both endpoints on the same prefix.
    //
    // Only provider nodes are remapped. A built-in provider keeps its registry
    // alias even if its connection happens to carry a `prefix` field.
    const nodePrefixByProvider = new Map();
    try {
      const [nodes, connections] = await Promise.all([
        getProviderNodes(),
        getProviderConnections(),
      ]);
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      // The connection copy of the prefix is written when the connection is
      // created and kept in sync when the node is edited, so it is the freshest
      // source; the node row is the fallback.
      const psdByProvider = new Map(
        connections
          .filter((c) => nodeById.has(c.provider))
          .map((c) => [c.provider, c.providerSpecificData || {}])
      );
      for (const node of nodes) {
        const prefix = resolveProviderPrefix({
          providerId: node.id,
          providerSpecificData: psdByProvider.get(node.id),
          node,
        });
        if (prefix) nodePrefixByProvider.set(node.id, prefix);
      }
    } catch (e) {
      console.log("Could not fetch provider nodes, falling back to provider aliases:", e);
    }

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = nodePrefixByProvider.get(m.provider) || getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps: {
            vision: c.vision,
            search: c.search,
            reasoning: c.reasoning,
            contextWindow: c.contextWindow,
            maxOutput: c.maxOutput,
          },
        };
      });

    // Custom models ride along; their stored caps override the name heuristic.
    // A custom row whose provider alias routes to an already-listed model is a
    // pure shadow: the real entry wins (and is listed first), but this row would
    // land later with the same routedModel key and the client's last-write-wins
    // map then serves its thinner caps (a pre-registry "add custom model" row
    // stores {vision, reasoning} only — no contextWindow). Drop the shadow and
    // resolve the survivors' provider id, not the UI alias: the capability
    // tables are keyed by provider id, and an alias like `ocg` misses the
    // provider-scoped entries and falls back to the generic patterns.
    const seenFull = new Set(models.map((m) => m.fullModel));
    const seenRouted = new Set(models.map((m) => m.routedModel));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      if (seenRouted.has(`${m.providerAlias}/${m.id}`)) return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      // Custom rows are stored against the raw provider id (the node id for
      // custom providers), but the published id must use the prefix the user
      // configured. The storage form stays available as storageFullModel so the
      // dashboard's capability lookup — which keys by provider id — still hits.
      const storageFullModel = `${m.providerAlias}/${m.id}`;
      const displayPrefix = nodePrefixByProvider.get(m.providerAlias) || m.providerAlias;
      const fullModel = `${displayPrefix}/${m.id}`;
      const providerId = ALIAS_TO_ID[m.providerAlias] || m.providerAlias;
      const c = getCapabilitiesForModel(providerId, m.id);
      models.push({
        provider: displayPrefix,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: fullModel,
        storageFullModel,
        alias: modelAliases[storageFullModel] || m.id,
        caps: {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
          ...(m.caps || {}),
        },
      });
    }

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
