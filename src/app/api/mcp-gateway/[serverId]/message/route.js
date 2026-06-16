import { NextResponse } from "next/server";
import { getMcpServerById } from "@/models";
import { sendToMcpServer } from "@/lib/mcp/mcpServerManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mcp-gateway/[serverId]/message - Send JSON-RPC to a specific MCP server
export async function POST(request, { params }) {
  const { serverId } = await params;
  const server = await getMcpServerById(serverId);
  if (!server) {
    return NextResponse.json({ error: `Unknown MCP server: ${serverId}` }, { status: 404 });
  }
  if (!server.isActive) {
    return NextResponse.json({ error: "MCP server is disabled" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const response = await sendToMcpServer(server, body);
    if (response) {
      return NextResponse.json(response);
    }
    // Stdio servers return null (fire-and-forget)
    return new Response(null, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
