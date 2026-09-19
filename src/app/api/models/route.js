import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getSettings } from "@/lib/localDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();
    const settings = await getSettings().catch(() => ({}));
    const customPlugins = settings?.customPlugins || {};
    const ivEnabled = Boolean(customPlugins.imageVision?.enabled);
    const ivModels = new Set(customPlugins.imageVision?.models || []);
    const tdEnabled = Boolean(customPlugins.thinkDeeper?.enabled);
    const tdModels = new Set(customPlugins.thinkDeeper?.models || []);
    const umEnabled = Boolean(customPlugins.unrestrictedMode?.enabled);
    const umModels = new Set(customPlugins.unrestrictedMode?.models || []);
    const smEnabled = Boolean(customPlugins.speedMode?.enabled);
    const smModels = new Set(customPlugins.speedMode?.models || []);

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        const caps = {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
        };
        if (ivEnabled && (ivModels.has(fullModel) || ivModels.has(routedModel) || ivModels.has(m.model))) {
          caps.vision = true;
        }
        if (tdEnabled && (tdModels.has(fullModel) || tdModels.has(routedModel) || tdModels.has(m.model))) {
          caps.reasoning = true;
          caps.thinkDeeper = true;
        }
        if (umEnabled && (umModels.has(fullModel) || umModels.has(routedModel) || umModels.has(m.model))) {
          caps.unrestrictedMode = true;
        }
        if (smEnabled && (smModels.has(fullModel) || smModels.has(routedModel) || smModels.has(m.model))) {
          caps.speedMode = true;
        }
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps,
        };
      });

    // Custom models ride along; their stored caps override the name heuristic
    const seenFull = new Set(models.map((m) => m.fullModel));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const c = getCapabilitiesForModel(m.providerAlias, m.id);
      const caps = {
        vision: c.vision,
        search: c.search,
        reasoning: c.reasoning,
        contextWindow: c.contextWindow,
        maxOutput: c.maxOutput,
        ...(m.caps || {}),
      };
      if (ivEnabled && (ivModels.has(fullModel) || ivModels.has(m.id))) {
        caps.vision = true;
      }
      if (tdEnabled && (tdModels.has(fullModel) || tdModels.has(m.id))) {
        caps.reasoning = true;
        caps.thinkDeeper = true;
      }
      if (umEnabled && (umModels.has(fullModel) || umModels.has(m.id))) {
        caps.unrestrictedMode = true;
      }
      if (smEnabled && (smModels.has(fullModel) || smModels.has(m.id))) {
        caps.speedMode = true;
      }
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: fullModel,
        alias: modelAliases[fullModel] || m.id,
        caps,
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
