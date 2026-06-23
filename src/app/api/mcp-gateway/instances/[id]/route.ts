import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { McpInstance } from "@/lib/db/repos/mcpInstancesRepo";
import { getInstanceById, updateInstance, deleteInstance } from "@/lib/localDb";

export const dynamic = "force-dynamic";

function stripSecrets(inst: McpInstance | null) {
  if (!inst) return inst;
  const { headers: _h, env: _e, oauthTokens: _o, ...out } = inst;
  void _h; void _e; void _o;
  return out;
}

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

interface PatchPayload {
  slug?: string;
  [key: string]: JsonValue | undefined;
}

function validatePatch(body: PatchPayload) {
  const errs: string[] = [];
  if (body.slug !== undefined) {
    if (!SLUG_RE.test(body.slug)) errs.push("slug must match ^[a-z0-9-]{2,40}$");
    if (body.slug.includes("__")) errs.push("slug cannot contain __");
  }
  return errs;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const inst = await getInstanceById(id);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ instance: stripSecrets(inst) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as PatchPayload;
    const errs = validatePatch(body);
    if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });
    const inst = await updateInstance(id, body);
    if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ instance: stripSecrets(inst) });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "DUPLICATE_SLUG") {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const ok = await deleteInstance(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
