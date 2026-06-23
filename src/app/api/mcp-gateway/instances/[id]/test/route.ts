import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { McpInstance } from "@/lib/db/repos/mcpInstancesRepo";
import { getInstanceById } from "@/lib/localDb";
import { clientFor } from "@/lib/mcp/gateway/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface McpTool { name: string; description?: string }
interface McpClient { listTools(instance: McpInstance): Promise<McpTool[]> }

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const inst = await getInstanceById(id);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    const mcpClient = clientFor(inst) as McpClient;
    const tools = await mcpClient.listTools(inst);
    return NextResponse.json({
      ok: true,
      toolCount: tools.length,
      sample: tools.slice(0, 5).map((t) => ({ name: t.name, description: t.description || "" })),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 200 }); // surface failure as ok:false so the dashboard can show it
  }
}
