import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/buildModelsList.js";
import { requireKey } from "../_auth.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/models (any valid key, READ-ONLY) — available model list.
export async function GET(request: NextRequest) {
  try {
    await requireKey(request);
    const data = await buildModelsList(["llm"]);
    const models = (data ?? []).map((m) => ({
      id: m.id,
      provider: m.owned_by,
      kind: m.kind ?? "llm",
    }));
    return NextResponse.json({ models });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
