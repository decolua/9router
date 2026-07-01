import { NextResponse } from "next/server";
import { getApiKeyById, resetApiKeyLimit } from "@/lib/localDb";

// POST /api/keys/[id]/reset - Reset the token usage counter for a key
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const result = await resetApiKeyLimit(id);
    if (!result) {
      return NextResponse.json({ error: "Failed to reset usage" }, { status: 500 });
    }

    return NextResponse.json({ id: result.id, limitResetAt: result.limitResetAt });
  } catch (error) {
    console.log("Error resetting key usage:", error);
    return NextResponse.json({ error: "Failed to reset usage" }, { status: 500 });
  }
}
