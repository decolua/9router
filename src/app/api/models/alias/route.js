import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias } from "@/models";
import { requireAdmin } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

// GET /api/models/alias - Get all aliases (admin only, global config)
export async function GET(request) {
  try {
    await requireAdmin(request);
    const aliases = await getModelAliases(null);
    return NextResponse.json({ aliases });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to fetch aliases" }, { status });
  }
}

// PUT /api/models/alias - Set model alias (admin only, global config)
export async function PUT(request) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    await setModelAlias(alias, model, null);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to update alias" }, { status });
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias (admin only, global config)
export async function DELETE(request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(alias, null);

    return NextResponse.json({ success: true });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to delete alias" }, { status });
  }
}
