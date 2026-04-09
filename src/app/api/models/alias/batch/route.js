import { NextResponse } from "next/server";
import { getDb } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * POST /api/models/alias/batch - Batch set model aliases
 * Body: { aliases: [{ model, alias }, ...] }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { aliases } = body;

    if (!Array.isArray(aliases) || aliases.length === 0) {
      return NextResponse.json({ error: "Aliases array required" }, { status: 400 });
    }

    // Get DB once and batch update
    const db = await getDb();
    
    if (!db.data.modelAliases) {
      db.data.modelAliases = {};
    }

    const results = [];
    for (const item of aliases) {
      const { model, alias } = item;
      if (model && alias) {
        db.data.modelAliases[alias] = model;
        results.push({ alias, model, success: true });
      } else {
        results.push({ alias, model, success: false, error: "Model and alias required" });
      }
    }

    // Write once after all updates
    await db.write();

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    return NextResponse.json({ 
      success: true, 
      imported: successful,
      failed: failed.length > 0 ? failed : undefined
    });
  } catch (error) {
    console.log("Error batch updating aliases:", error);
    return NextResponse.json({ error: "Failed to batch update aliases" }, { status: 500 });
  }
}