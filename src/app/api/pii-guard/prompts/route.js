import { NextResponse } from "next/server";
import { message, search } from "@/lib/piiGuard/prompts.js";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const ID = /^[\w:.@-]{1,200}$/;

// Masked prompts. Always behind login (dashboardGuard ALWAYS_PROTECTED), even when requireLogin is off.
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const int = (k, d) => { const v = p.get(k); if (v === null || v === "") return d; const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : NaN; };
  if (p.has("id")) {
    const id = int("id", NaN);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400, headers: NO_STORE });
    const m = message(id);
    return m ? NextResponse.json(m, { headers: NO_STORE }) : NextResponse.json({ error: "Not found or expired" }, { status: 404, headers: NO_STORE });
  }
  const q = (p.get("q") || "").slice(0, 200);
  const [sessionId, requestId, hash] = ["sessionId", "requestId", "hash"].map((k) => p.get(k) || "");
  if ([sessionId, requestId].some((v) => v && !ID.test(v)) || (hash && !/^[0-9a-f]{12}$/.test(hash))) return NextResponse.json({ error: "Invalid filter" }, { status: 400, headers: NO_STORE });
  const from = int("from", 0), to = int("to", Date.now()), before = int("before", Infinity), limit = int("limit", 50);
  if ([from, to, before, limit].some(Number.isNaN)) return NextResponse.json({ error: "Invalid range" }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(search({ q, sessionId, requestId, hash, from, to, before, limit }), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500, headers: NO_STORE });
  }
}
