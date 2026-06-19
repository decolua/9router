import { NextResponse } from "next/server";
import { isLocalRequest } from "@/dashboardGuard";
import {
  getGatewayKeyById,
  deleteGatewayKey,
  getGrantsForKeyDetailed,
  setGrants,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";

function stripKey(k) {
  if (!k) return k;
  const { key, ...rest } = k;
  return rest;
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const k = await getGatewayKeyById(id);
    if (!k) return NextResponse.json({ error: "not found" }, { status: 404 });
    const grants = await getGrantsForKeyDetailed(id);
    const url = new URL(request.url);
    const reveal = url.searchParams.get("reveal") === "1";
    // reveal=1 returns the raw key. Restrict to local requests (SSRF-style
    // protection — remote callers must copy keys from the creation modal).
    if (reveal && !isLocalRequest(request)) {
      return NextResponse.json(
        { error: "Key reveal is only available from local requests." },
        { status: 403 }
      );
    }
    return NextResponse.json({ key: reveal ? k : stripKey(k), grants });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}


export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (Array.isArray(body.grants)) {
      await setGrants(id, body.grants, body.toolAllowlists);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const ok = await deleteGatewayKey(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
