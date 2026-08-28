import { NextResponse } from "next/server";
import { acknowledgeModels } from "@/models";

export const dynamic = "force-dynamic";

// POST /api/models/new/acknowledge
// Body (optional): { items: [{ providerAlias, modelId }] }
// Without items, acknowledges ALL currently-unseen models (e.g. "Mark all as read").
export async function POST(request) {
  try {
    let items = null;
    try {
      const body = await request.json();
      if (Array.isArray(body?.items)) items = body.items;
    } catch {
      // No/empty body → acknowledge all
    }

    await acknowledgeModels(items);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error acknowledging models:", error);
    return NextResponse.json({ error: "Failed to acknowledge models" }, { status: 500 });
  }
}
