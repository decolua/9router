import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const progress = global._pingProgress || { total: 0, completed: 0, current: "", status: "idle" };
  return NextResponse.json(progress);
}
