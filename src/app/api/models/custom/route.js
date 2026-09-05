import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, deleteCustomModel, updateCustomModel, deleteCustomModelsByProvider } from "@/models";
import { OVERRIDABLE_CAPABILITY_KEYS } from "open-sse/providers/capabilities.js";

export const dynamic = "force-dynamic";

// Whitelist-sanitize user-toggleable capability flags; undefined when nothing valid.
function sanitizeCaps(caps) {
  if (!caps || typeof caps !== "object") return undefined;
  const clean = {};
  for (const key of OVERRIDABLE_CAPABILITY_KEYS) {
    if (typeof caps[key] === "boolean") clean[key] = caps[key];
  }
  return Object.keys(clean).length === 0 ? undefined : clean;
}

// GET /api/models/custom - List all custom models
export async function GET() {
  try {
    const models = await getCustomModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// POST /api/models/custom - Add custom model
export async function POST(request) {
  try {
    const { providerAlias, id, type, name, caps } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const added = await addCustomModel({ providerAlias, id, type: type || "llm", name, caps: sanitizeCaps(caps) });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: "Failed to add custom model" }, { status: 500 });
  }
}

// PUT /api/models/custom - Edit a custom model (rename id and/or change caps/name)
export async function PUT(request) {
  try {
    const { providerAlias, id, newId, type, name, caps } = await request.json();
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    if (newId !== undefined && (typeof newId !== "string" || !newId.trim())) {
      return NextResponse.json({ error: "newId must be a non-empty string" }, { status: 400 });
    }
    const { updated, error } = await updateCustomModel({
      providerAlias,
      id,
      newId: newId ? newId.trim() : undefined,
      type: type || "llm",
      name,
      caps: sanitizeCaps(caps),
    });
    if (!updated) {
      return NextResponse.json({ error: error || "Failed to update custom model" }, { status: error === "Model not found" ? 404 : 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error updating custom model:", error);
    return NextResponse.json({ error: "Failed to update custom model" }, { status: 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz  (single)
// DELETE /api/models/custom?providerAlias=xxx&all=true[&type=zzz] (bulk clear)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    const all = searchParams.get("all") === "true";
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    if (all) {
      // Clear all custom models for this provider. Omit type param to wipe every type.
      const removeType = searchParams.get("type") || null;
      const deleted = await deleteCustomModelsByProvider(providerAlias, removeType);
      return NextResponse.json({ success: true, deleted });
    }
    if (!id) {
      return NextResponse.json({ error: "id required (or pass all=true)" }, { status: 400 });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
