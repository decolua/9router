import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias } from "@/models";
import { requireAdmin } from "@/lib/auth/helpers";
import { AI_MODELS } from "@/shared/constants/config";

// GET /api/models - Get models with aliases (global config)
export async function GET() {
  try {
    const modelAliases = await getModelAliases(null);
    
    const models = AI_MODELS.map((m) => {
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
}

// PUT /api/models - Update model alias (admin only, global config)
export async function PUT(request) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases(null);

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias (alias, model, userId)
    await setModelAlias(alias, model, null);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to update alias" }, { status });
  }
}
