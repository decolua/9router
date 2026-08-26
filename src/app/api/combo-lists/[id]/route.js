import { NextResponse } from "next/server";
import { DEFAULT_COMBO_LIST_ID, deleteComboList, getComboLists, renameComboList } from "@/lib/localDb";
import { normalizeListName } from "../route";

export const dynamic = "force-dynamic";

// PUT /api/combo-lists/[id] — rename a list (default list renameable)
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body.name !== undefined) {
      const normalized = normalizeListName(body.name);
      if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: normalized.status });
      const renamed = await renameComboList(id, normalized.name);
      if (!renamed) return NextResponse.json({ error: "清单不存在" }, { status: 404 });
    }

    const lists = await getComboLists({ withCounts: true });
    return NextResponse.json({ lists });
  } catch (error) {
    const conflict = String(error.message || "").includes("UNIQUE");
    return NextResponse.json(
      { error: conflict ? "同名清单已存在" : "更新清单失败" },
      { status: conflict ? 409 : 500 }
    );
  }
}

// DELETE /api/combo-lists/[id] — delete; combos move to default atomically.
// Default list deletion is rejected server-side even though the UI hides it.
export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    if (id === DEFAULT_COMBO_LIST_ID) {
      return NextResponse.json({ error: "默认清单不能删除" }, { status: 409 });
    }
    const deleted = await deleteComboList(id);
    if (!deleted) return NextResponse.json({ error: "清单不存在" }, { status: 404 });
    const lists = await getComboLists({ withCounts: true });
    return NextResponse.json({ lists });
  } catch (error) {
    console.error("Error deleting combo list:", error);
    return NextResponse.json({ error: "删除清单失败" }, { status: 500 });
  }
}

// Reorder lives at /api/combo-lists/reorder (collection-level operation).
