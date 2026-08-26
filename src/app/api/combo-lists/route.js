import { NextResponse } from "next/server";
import { createComboList, getComboLists } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 50;

export function normalizeListName(value) {
  if (typeof value !== "string") return { error: "清单名称必须是字符串", status: 400 };
  const name = value.trim().slice(0, 100).trim();
  if (!name) return { error: "清单名称不能为空", status: 400 };
  if (name.length > MAX_NAME_LENGTH) return { error: `清单名称不能超过 ${MAX_NAME_LENGTH} 个字符`, status: 400 };
  return { name };
}

// GET /api/combo-lists — all lists (sorted), with combo counts
export async function GET() {
  try {
    return NextResponse.json({ lists: await getComboLists({ withCounts: true }) });
  } catch (error) {
    console.error("Error fetching combo lists:", error);
    return NextResponse.json({ error: "获取模型组合清单失败" }, { status: 500 });
  }
}

// POST /api/combo-lists — create a list
export async function POST(request) {
  try {
    const body = await request.json();
    const normalized = normalizeListName(body?.name);
    if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: normalized.status });
    const list = await createComboList(normalized.name);
    return NextResponse.json({ list }, { status: 201 });
  } catch (error) {
    const conflict = String(error.message || "").includes("UNIQUE");
    return NextResponse.json(
      { error: conflict ? "同名清单已存在" : "创建清单失败" },
      { status: conflict ? 409 : 500 }
    );
  }
}
