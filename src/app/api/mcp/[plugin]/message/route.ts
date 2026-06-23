import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { sendToChild, findPlugin } from "@/lib/mcp/stdioSseBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ plugin: string }> }) {
  const { plugin } = await context.params;
  if (!findPlugin(plugin)) {
    return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
  }
  try {
    const body = await request.json() as JsonValue;
    sendToChild(plugin, body);
    return new Response(null, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
