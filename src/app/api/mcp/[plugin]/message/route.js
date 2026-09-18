import { NextResponse } from "next/server";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";
import { hasValidCliToken } from "@/dashboardGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  // Require CLI token for MCP plugin message endpoint
  if (!(await hasValidCliToken(request))) {
    return NextResponse.json({ error: "Unauthorized: CLI token required" }, { status: 401 });
  }

  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
  }
  try {
    const body = await request.json();
    sendToChild(plugin, body);
    return new Response(null, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
