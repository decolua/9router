import { NextResponse } from "next/server";
import { handleToolsList } from "@/lib/mcp";

export const dynamic = "force-dynamic";

// GET /api/mcp-servers/tools
// Aggregates the tools exposed by all active MCP servers for the dashboard
// (e.g. the "Create MCP Combo" tool picker).
//
// This is an INTERNAL dashboard endpoint and is intentionally NOT gated by an
// `mcp_` gateway API key — it runs behind the app's existing dashboard auth,
// same as every other `/api/*` dashboard route.
export async function GET() {
  try {
    const response = await handleToolsList({
      jsonrpc: "2.0",
      id: "dashboard-tools-list",
    });
    return NextResponse.json(response);
  } catch (err) {
    console.error("[api/mcp-servers/tools] failed:", err);
    return NextResponse.json(
      { error: err.message || String(err) },
      { status: 500 },
    );
  }
}
