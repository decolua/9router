import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { catalogCapsResolver, catalogProviderId } from "@/lib/modelCatalogCaps";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

function modelLabel(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    const customRows = await getCustomModels();
    const resolveCaps = catalogCapsResolver(customRows);
    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(catalogProviderId(m.provider)) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = getProviderAlias(catalogProviderId(m.provider)) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = resolveCaps(m.provider, m.model);
        const thinkingLevels = getThinkingLevels(m.provider, m.model);
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelLabel(modelAliases[fullModel], m.model),
          // Same per-model set /v1/models already publishes, so CLI-tool cards can
          // seed thinking levels instead of guessing them (Pi, opencode).
          ...(Array.isArray(thinkingLevels) && thinkingLevels.length > 0 ? { thinking_levels: thinkingLevels } : {}),
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
    const customModels = customRows.filter((m) => {
      if (!modelLabel(m?.id, "") || !modelLabel(m?.providerAlias, "") || (m.kind || m.type || "llm") !== "llm") return false;
      if (seenRouted.has(`${m.providerAlias}/${m.id}`)) return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const providerId = catalogProviderId(m.providerAlias);
      const c = resolveCaps(providerId, m.id);
      const thinkingLevels = getThinkingLevels(providerId, m.id);
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: modelLabel(m.name, m.id),
        fullModel,
        routedModel: fullModel,
        alias: modelLabel(modelAliases[fullModel], m.id),
        ...(Array.isArray(thinkingLevels) && thinkingLevels.length > 0 ? { thinking_levels: thinkingLevels } : {}),
        caps: {
          vision: typeof m.caps?.vision === "boolean" ? m.caps.vision : c.vision,
          search: typeof m.caps?.search === "boolean" ? m.caps.search : c.search,
          reasoning: typeof m.caps?.reasoning === "boolean" ? m.caps.reasoning : c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
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
