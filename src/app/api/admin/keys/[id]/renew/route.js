import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { renewApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../../../../lib/api-keys/plans.js";

const RENEW_ERROR = "Valid planMonths is required";

export async function POST(request, { params }) {
  if (!(await requireAdminApiKey(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const key = await renewApiKey(id, normalizePlanMonths(body?.planMonths));
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key });
  } catch (error) {
    if (error instanceof SyntaxError || error?.message?.startsWith("Plan must be one of")) {
      return NextResponse.json({ error: RENEW_ERROR }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to renew key" }, { status: 500 });
  }
}
