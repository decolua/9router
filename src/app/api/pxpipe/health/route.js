import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/pxpipe/service.js";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runHealthCheck();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ healthy: false, checks: [], error: error.message }, { status: 500 });
  }
}

// GET mirrors POST so the card can probe on page load without a mutation call.
export const GET = POST;
