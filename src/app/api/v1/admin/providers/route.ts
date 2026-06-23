import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import REGISTRY from "open-sse/providers/registry/index.js";
import { requireKey } from "../_auth.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/providers (any valid key, READ-ONLY) — list provider ids
// + display names so users know what to put in allow-lists. No secrets.
export async function GET(request: NextRequest) {
  try {
    await requireKey(request);
    const providers = (REGISTRY as Array<{
      id: string;
      displayName?: string;
      aliases?: string[];
      alias?: string;
    }> ?? []).map((p) => ({
      id: p.id,
      displayName: p.displayName ?? p.id,
      aliases: Array.isArray(p.aliases) ? p.aliases : [],
      alias: p.alias ?? null,
    }));
    return NextResponse.json({ providers });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
