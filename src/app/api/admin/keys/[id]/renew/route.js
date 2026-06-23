import { NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/auth/adminApiKey";
import { renewApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../../../../lib/api-keys/plans.js";

const RENEW_ERROR = "Valid planMonths is required";

async function authorize(request) {
  try {
    if (await requireAdminApiKey(request)) return null;
  } catch {
    // Fail closed if the admin key check throws or rejects.
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request, { params }) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;

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
