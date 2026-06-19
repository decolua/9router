import { NextResponse } from "next/server";
import {
  getApiKeys,
  getApiKeyById,
  updateApiKey,
  deleteApiKey,
  getMonthlyUsageForKey,
} from "@/lib/localDb";
import { requireKey, requireAdmin, publicKeyView } from "../../_auth.js";

export const dynamic = "force-dynamic";

async function countActiveAdmins() {
  const keys = await getApiKeys();
  return keys.filter((k) => k.role === "admin" && k.isActive).length;
}

// GET /api/v1/admin/keys/{id} (admin)
export async function GET(request, { params }) {
  try {
    const { record } = await requireKey(request);
    requireAdmin(record);
    const { id } = await params;
    const k = await getApiKeyById(id);
    if (!k) return NextResponse.json({ error: "not found" }, { status: 404 });
    const v = publicKeyView(k);
    try {
      const u = await getMonthlyUsageForKey(k.key);
      v.usageThisMonth = {
        tokens: u.tokens,
        cost: u.cost,
        requests: u.requests,
        monthStart: u.monthStart,
      };
    } catch {
      v.usageThisMonth = null;
    }
    return NextResponse.json({ key: v });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

// PATCH /api/v1/admin/keys/{id} (admin)
export async function PATCH(request, { params }) {
  try {
    const { record } = await requireKey(request);
    requireAdmin(record);
    const { id } = await params;
    const body = await request.json();
    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    // last-admin guard
    if (existing.role === "admin" && body.role && body.role !== "admin") {
      const admins = await countActiveAdmins();
      if (admins <= 1) {
        return NextResponse.json({ error: "cannot remove last admin" }, { status: 409 });
      }
    }
    // isActive=false on the last admin also strands the system.
    if (existing.role === "admin" && body.isActive === false) {
      const admins = await countActiveAdmins();
      if (admins <= 1) {
        return NextResponse.json({ error: "cannot deactivate last admin" }, { status: 409 });
      }
    }
    const updated = await updateApiKey(id, body);
    return NextResponse.json({ key: publicKeyView(updated) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

// DELETE /api/v1/admin/keys/{id} (admin)
export async function DELETE(request, { params }) {
  try {
    const { record } = await requireKey(request);
    requireAdmin(record);
    const { id } = await params;
    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.role === "admin") {
      const admins = await countActiveAdmins();
      if (admins <= 1) {
        return NextResponse.json({ error: "cannot remove last admin" }, { status: 409 });
      }
    }
    const ok = await deleteApiKey(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
