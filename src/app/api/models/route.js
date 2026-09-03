import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias, resolveProviderId } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getProviderConnections } from "@/lib/localDb";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();
    const allCustomModels = await getCustomModels();
    const customByFullModel = new Map();
    for (const model of allCustomModels) {
      if ((model.kind || model.type || "llm") !== "llm") continue;
      const fullModel = `${model.providerAlias}/${model.id}`;
      customByFullModel.set(fullModel, model);
      const normalizedModel = `${resolveProviderId(model.providerAlias)}/${model.id}`;
      if (!customByFullModel.has(normalizedModel)) customByFullModel.set(normalizedModel, model);
    }

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
        const c = {
          ...getCapabilitiesForModel(resolveProviderId(m.provider), m.model),
          ...(customByFullModel.get(`${providerAlias}/${m.model}`)?.caps
            || customByFullModel.get(fullModel)?.caps
            || customByFullModel.get(`${resolveProviderId(m.provider)}/${m.model}`)?.caps
            || {}),
        };
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps: {
            vision: c.vision,
            pdf: c.pdf,
            audioInput: c.audioInput,
            videoInput: c.videoInput,
            search: c.search,
            reasoning: c.reasoning,
            contextWindow: c.contextWindow,
            maxOutput: c.maxOutput,
          },
        };
      });

    // Custom models ride along; their stored caps override the name heuristic
    const seenFull = new Set(models.map((m) => m.fullModel));
    const connections = await getProviderConnections();
    const prefixes = new Map(connections
      .filter((connection) => connection.providerSpecificData?.prefix)
      .map((connection) => [connection.provider, connection.providerSpecificData.prefix]));
    const customModels = allCustomModels.filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const routedModel = `${prefixes.get(m.providerAlias) || m.providerAlias}/${m.id}`;
      const c = getCapabilitiesForModel(resolveProviderId(m.providerAlias), m.id);
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel,
        alias: modelAliases[fullModel] || m.id,
        caps: {
          vision: c.vision,
          pdf: c.pdf,
          audioInput: c.audioInput,
          videoInput: c.videoInput,
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
