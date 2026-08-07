// SSE message POST endpoint: client sends JSON-RPC here, we route the
// response back over the open SSE stream identified by sessionId.

import { NextResponse } from "next/server";
import { handleJsonRpc } from "@/lib/mcp/gateway/handler";
import { getSession } from "@/lib/mcp/gateway/sseSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sessionId");
  if (!sid) return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  const session = getSession(sid);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "parse error" }, { status: 400 });
  }

  const out = await handleJsonRpc(request, body);
  if (out.kind === "notification") {
    return new Response(null, { status: 202 });
  }
  // Push the response back over SSE.
  const outBody = out.kind === "response" ? out.body : out.items;
  try {
    session.send(`event: message\ndata: ${JSON.stringify(outBody)}\n\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `sse send failed: ${msg}` }, { status: 500 });
  }
  return new Response(null, { status: 202 });
}
