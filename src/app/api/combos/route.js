import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName, getComboListById, moveCombosToList } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

function normalizeDescription(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new TypeError("Description must be a string");
  return value.trim().slice(0, 500);
}

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind } = body;
    let description;
    try {
      description = normalizeDescription(body.description);
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    const combo = await createCombo({ name, description, models: models || [], kind: kind || null, listId: body.listId || null });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}

// POST /api/combos/batch — body: { action: "move"|"delete", ids: [...], listId? }
// Atomic: all-or-nothing per request. Keeps single-delete semantics callers rely on.
export async function PUT(request) {
  try {
    const body = await request.json();
    const { action } = body;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === "string" && id) : [];
    if (!ids.length) return NextResponse.json({ error: "缺少有效的组合 ID 列表" }, { status: 400 });

    if (action === "delete") {
      const { deleteCombosByIds, getComboById } = await import("@/lib/localDb");
      const { resetComboRotation } = await import("open-sse/services/combo.js");
      // Capture names before deletion so rotation state can be invalidated.
      const targets = [];
      for (const id of ids) {
        const combo = await getComboById(id);
        if (combo) targets.push(combo);
      }
      const deletedIds = await deleteCombosByIds(ids);
      // Only invalidate rotation for combos this request actually deleted.
      for (const combo of targets.filter((t) => deletedIds.includes(t.id))) resetComboRotation(combo.name);
      return NextResponse.json({ deletedIds, combos: await getCombos() });
    }

    if (action === "move") {
      const listId = typeof body.listId === "string" ? body.listId : "";
      if (!listId) return NextResponse.json({ error: "缺少目标清单 ID" }, { status: 400 });
      // Unknown target list is a client error, not a silent no-op.
      if (!(await getComboListById(listId))) return NextResponse.json({ error: "目标清单不存在" }, { status: 404 });
      const moved = await moveCombosToList(ids, listId);
      return NextResponse.json({ movedIds: moved, combos: await getCombos() });
    }

    return NextResponse.json({ error: "不支持的操作类型" }, { status: 400 });
  } catch (error) {
    console.log("Error in combos batch op:", error);
    return NextResponse.json({ error: "批量操作失败" }, { status: 500 });
  }
}
