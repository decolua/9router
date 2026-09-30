import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";
import { reconcileAllowedModels } from "@/lib/db/repos/apiKeysRepo";

export const dynamic = "force-dynamic";

// GET /api/models/alias - Get all aliases
export async function GET() {
  try {
    const aliases = await getModelAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT /api/models/alias - Set model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const previous = (await getModelAliases())?.[alias];
    await setModelAlias(alias, model);
    // The alias name is the map key, so it does not move. What does move is the
    // model it resolved to: a key that pinned the old target now follows the alias
    // to the new one instead of pointing at whatever now occupies that name.
    if (previous && previous !== model) {
      await reconcileAllowedModels({ renamed: { [previous.toLowerCase()]: model } });
    }

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(alias);
    const { emptied } = await reconcileAllowedModels({ removed: [alias] });

    return NextResponse.json({ success: true, ...(emptied.length ? { keysLeftForReview: emptied } : {}) });
  } catch (error) {
    console.log("Error deleting alias:", error);
    return NextResponse.json({ error: "Failed to delete alias" }, { status: 500 });
  }
}
