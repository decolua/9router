// Streamable-HTTP endpoint for the MCP gateway.
//
// A single POST handles a single JSON-RPC request (most harnesses today).
// Some clients send an `Accept: text/event-stream` request — we always
// return JSON for simplicity, which is widely accepted. Notifications
// (no `id`) return 202 Accepted with no body, as per the MCP transport.

import { NextResponse } from "next/server";
import { handleJsonRpc } from "@/lib/mcp/gateway/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400 }
    );
  }
  const out = await handleJsonRpc(request, body);
  if (out.kind === "notification") return new Response(null, { status: 202 });
  if (out.kind === "response") return NextResponse.json(out.body, { status: out.status || 200 });
  return NextResponse.json(out.items, { status: 200 });
}

// GET is allowed for capability discovery — returns 405 with the same
// Accept-Post header MCP transports use.
export async function GET() {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "POST JSON-RPC requests" } }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } }
  );
}
