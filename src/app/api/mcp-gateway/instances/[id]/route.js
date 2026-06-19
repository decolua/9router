import { NextResponse } from "next/server";
import { getInstanceById, updateInstance, deleteInstance } from "@/lib/localDb";
import { clientFor } from "@/lib/mcp/gateway/client";

export const dynamic = "force-dynamic";

function stripSecrets(inst) {
  if (!inst) return inst;
  const out = { ...inst };
  delete out.headers;
  delete out.env;
  delete out.oauthTokens;
  return out;
}

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

function validatePatch(body) {
  const errs = [];
  if (body.slug !== undefined) {
    if (!SLUG_RE.test(body.slug)) errs.push("slug must match ^[a-z0-9-]{2,40}$");
    if (body.slug.includes("__")) errs.push("slug cannot contain __");
  }
  return errs;
}

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const inst = await getInstanceById(id);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ instance: stripSecrets(inst) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const errs = validatePatch(body);
    if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });
    const inst = await updateInstance(id, body);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ instance: stripSecrets(inst) });
  } catch (e) {
    if (e?.code === "DUPLICATE_SLUG") {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const ok = await deleteInstance(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
