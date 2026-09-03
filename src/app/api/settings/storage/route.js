import { NextResponse } from "next/server";
import { DATA_FILE } from "@/lib/db/paths.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ databaseLocation: DATA_FILE });
}
