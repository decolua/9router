import { NextResponse } from "next/server";
import { getInstanceById } from "@/lib/localDb";
import { clientFor } from "@/lib/mcp/gateway/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request, { params }) {
  try {
    const { id } = await params;
    const inst = await getInstanceById(id);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    const tools = await clientFor(inst).listTools(inst);
    return NextResponse.json({
      ok: true,
      toolCount: tools.length,
      sample: tools.slice(0, 5).map((t) => ({ name: t.name, description: t.description || "" })),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e?.message || String(e),
    }, { status: 200 }); // surface failure as ok:false so the dashboard can show it
  }
}
