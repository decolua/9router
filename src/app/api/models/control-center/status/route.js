import { NextResponse } from "next/server";
import { readControlCenter } from "@/lib/modelControlCenter/store.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = readControlCenter();
  return NextResponse.json({
    syncedAt: state.syncedAt,
    testedAt: state.testedAt,
    summary: state.summary,
  });
}
