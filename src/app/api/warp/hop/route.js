import { NextResponse } from "next/server";
import { hop } from "@/lib/warp";

// POST /api/warp/hop - manually rotate the WARP egress identity
export async function POST() {
  try {
    const result = await hop({ force: true });
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    console.log("Error hopping WARP:", error);
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
