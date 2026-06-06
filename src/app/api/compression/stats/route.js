import { NextResponse } from "next/server";
import { getCompressionStats } from "@/lib/compressionStats";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getCompressionStats();
  return NextResponse.json(stats);
}
