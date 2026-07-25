import { NextResponse } from "next/server";
import { cleanupBrokenModels } from "@/lib/cleanupBroken.js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await cleanupBrokenModels();
    return NextResponse.json({ ...result, freshStart: true });
  } catch (error) {
    console.error("[cleanup-broken] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
