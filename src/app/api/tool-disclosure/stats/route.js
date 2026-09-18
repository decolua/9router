import { getRecentStats } from "open-sse/utils/toolDisclosure.js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRecentStats());
}
