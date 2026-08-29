import { NextResponse } from "next/server";
import { rebuildControlCenter } from "@/lib/modelControlCenter/catalog.js";
import { readControlCenter } from "@/lib/modelControlCenter/store.js";

export const dynamic = "force-dynamic";

export async function GET() {
  let state = readControlCenter();
  if (Object.keys(state.providers || {}).length === 0) {
    state = await rebuildControlCenter([]);
  }
  return NextResponse.json(state);
}
