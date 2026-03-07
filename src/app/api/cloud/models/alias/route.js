import { NextResponse } from "next/server";
import { validateApiKey, getModelAliases, setModelAlias } from "@/models";
import { requireAdmin } from "@/lib/auth/helpers";

// PUT /api/cloud/models/alias - Set model alias (admin only, global config)
export async function PUT(request) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    // Check if alias already exists for different model (global)
    const aliases = await getModelAliases(null);
    const existingModel = aliases[alias];
    if (existingModel && existingModel !== model) {
      return NextResponse.json({ 
        error: `Alias '${alias}' already in use for model '${existingModel}'` 
      }, { status: 400 });
    }

    // Update alias (global config)
    await setModelAlias(alias, model, null);

    return NextResponse.json({ 
      success: true, 
      model, 
      alias,
      message: `Alias '${alias}' set for model '${model}'`
    });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to update alias" }, { status });
  }
}

// GET /api/cloud/models/alias - Get all aliases (global config)
export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const apiKey = authHeader?.replace("Bearer ", "");

    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 401 });
    }

    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const aliases = await getModelAliases(null);

    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}
