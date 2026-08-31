import { NextResponse } from "next/server";
import { getApiKeyById, getKeyAccounts, setKeyAccounts } from "@/lib/localDb";

// GET /api/keys/[id]/accounts - Current provider-account scoping for a key.
// Empty connectionIds means unrestricted (full pool) — back-compat default.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    const connectionIds = await getKeyAccounts(id);
    return NextResponse.json({ connectionIds });
  } catch (error) {
    console.log("Error fetching key accounts:", error);
    return NextResponse.json({ error: "Failed to fetch key accounts" }, { status: 500 });
  }
}

// PUT /api/keys/[id]/accounts - Replace the full set of accounts a key may use.
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    const body = await request.json();
    if (!Array.isArray(body.connectionIds)) {
      return NextResponse.json({ error: "connectionIds must be an array" }, { status: 400 });
    }
    const connectionIds = await setKeyAccounts(id, body.connectionIds);
    return NextResponse.json({ connectionIds });
  } catch (error) {
    console.log("Error updating key accounts:", error);
    return NextResponse.json({ error: "Failed to update key accounts" }, { status: 500 });
  }
}
