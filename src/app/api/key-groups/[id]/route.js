import { NextResponse } from "next/server";
import { deleteApiKeyGroup, getApiKeyGroupById, updateApiKeyGroup } from "@/lib/localDb";

function normalizeList(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) return null;
  return [...new Set(value.map((item) => item.trim()))];
}

export async function GET(_request, { params }) {
  const { id } = await params;
  const group = await getApiKeyGroupById(id);
  return group ? NextResponse.json({ group }) : NextResponse.json({ error: "密钥分组不存在" }, { status: 404 });
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const current = await getApiKeyGroupById(id);
    if (!current) return NextResponse.json({ error: "密钥分组不存在" }, { status: 404 });
    const body = await request.json();
    const data = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "分组名称不能为空" }, { status: 400 });
      data.name = name;
    }
    for (const field of ["allowedModels", "allowedCombos"]) {
      if (body[field] !== undefined) {
        const value = normalizeList(body[field]);
        if (!value) return NextResponse.json({ error: "模型与模型组合必须是字符串列表" }, { status: 400 });
        data[field] = value;
      }
    }
    return NextResponse.json({ group: await updateApiKeyGroup(id, data) });
  } catch (error) {
    const conflict = String(error.message || "").includes("UNIQUE");
    return NextResponse.json({ error: conflict ? "分组名称已存在" : "更新密钥分组失败" }, { status: conflict ? 409 : 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteApiKeyGroup(id);
    return deleted ? NextResponse.json({ message: "密钥分组已删除" }) : NextResponse.json({ error: "密钥分组不存在" }, { status: 404 });
  } catch (error) {
    const conflict = error.code === "GROUP_PROTECTED" || error.code === "GROUP_IN_USE";
    return NextResponse.json({ error: error.message || "删除密钥分组失败" }, { status: conflict ? 409 : 500 });
  }
}
