import { NextResponse } from "next/server";
import { createApiKeyGroup, getApiKeyGroups } from "@/lib/localDb";

export const dynamic = "force-dynamic";

function normalizeList(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) return null;
  return [...new Set(value.map((item) => item.trim()))];
}

export async function GET() {
  try {
    return NextResponse.json({ groups: await getApiKeyGroups() });
  } catch (error) {
    console.error("Error fetching API key groups:", error);
    return NextResponse.json({ error: "获取密钥分组失败" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const allowedModels = normalizeList(body.allowedModels || []);
    const allowedCombos = normalizeList(body.allowedCombos || []);
    if (!name) return NextResponse.json({ error: "分组名称不能为空" }, { status: 400 });
    if (!allowedModels || !allowedCombos) return NextResponse.json({ error: "模型与模型组合必须是字符串列表" }, { status: 400 });
    return NextResponse.json({ group: await createApiKeyGroup({ name, allowedModels, allowedCombos }) }, { status: 201 });
  } catch (error) {
    const conflict = String(error.message || "").includes("UNIQUE");
    return NextResponse.json({ error: conflict ? "分组名称已存在" : "创建密钥分组失败" }, { status: conflict ? 409 : 500 });
  }
}
