import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { withAuthUser } from "@/lib/auth/runtimeUserContext.js";

// GET /api/models - Get models with aliases
export const GET = withAuthUser(async (_request, _ctx, user) => {
  try {
    const modelAliases = await getModelAliases(user.id);
    const disabled = await getDisabledModels();

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        return {
          ...m,
          fullModel,
          alias: modelAliases[fullModel] || m.model,
        };
      });

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
});

// PUT /api/models - Update model alias
export const PUT = withAuthUser(async (request, _ctx, user) => {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases(user.id);

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === model && key !== alias
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(user.id, alias, model);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
});
