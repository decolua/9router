import { NextResponse } from "next/server";
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

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const k = await getGatewayKeyById(id);
    if (!k) return NextResponse.json({ error: "not found" }, { status: 404 });
    const grants = await getGrantsForKeyDetailed(id);
    return NextResponse.json({ key: stripKey(k), grants });
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
