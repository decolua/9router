import { NextResponse } from "next/server";
import { validateApiKey, getModelAliases, setModelAlias } from "@/models";

// PUT /api/cloud/models/alias - Set model alias (for cloud/CLI)
export async function PUT(request) {
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

    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    // Check if alias already exists for different model
    const aliases = await getModelAliases();
    const existingModel = aliases[alias];
    if (existingModel && existingModel !== model) {
      return NextResponse.json({ 
        error: `Alias '${alias}' already in use for model '${existingModel}'` 
      }, { status: 400 });
    }

    // Update alias
    await setModelAlias(alias, model);

    return NextResponse.json({ 
      success: true, 
      model, 
      alias,
      message: `Alias '${alias}' set for model '${model}'`
    });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}

// GET /api/cloud/models/alias - Get all aliases
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

    const aliases = await getModelAliases();

    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}
