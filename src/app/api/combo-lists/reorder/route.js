import { NextResponse } from "next/server";
import { getComboLists, reorderComboLists } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// POST /api/combo-lists/reorder — body: { orderedIds: [id, ...] }
// Sort orders are normalized to 0..n-1 inside reorderComboLists.
export async function POST(request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body?.orderedIds)) {
      return NextResponse.json({ error: "orderedIds 必须是列表" }, { status: 400 });
    }
    if (body.orderedIds.length === 0) {
      return NextResponse.json({ error: "orderedIds 不能为空" }, { status: 400 });
    }
    const lists = await reorderComboLists(body.orderedIds.map(String));
    return NextResponse.json({ lists });
  } catch (error) {
    console.error("Error reordering combo lists:", error);
    return NextResponse.json({ error: "排序清单失败" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ lists: await getComboLists({ withCounts: true }) });
}
