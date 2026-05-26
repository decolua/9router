import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/api-keys
 * Returns list of API keys from apiKeys table with their names
 */
export async function GET() {
  try {
    const db = await getAdapter();

    const rows = db.all(`
      SELECT key, name FROM apiKeys WHERE isActive = 1 ORDER BY name
    `);

    const apiKeys = rows.map(r => ({
      key: r.key,
      name: r.name || r.key.slice(0, 8) + "...",
      masked: r.key.slice(0, 8) + "..."
    }));

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error("[API] Failed to get API keys:", error);
    return NextResponse.json({ error: "Failed to fetch API keys" }, { status: 500 });
  }
}