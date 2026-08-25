import { NextResponse } from "next/server";
import { testMcpServer } from "@/models";

export const dynamic = "force-dynamic";

// POST /api/mcp-servers/[id]/test - Test MCP server connectivity
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await testMcpServer(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error testing MCP server:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
