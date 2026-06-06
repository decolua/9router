import { NextResponse } from "next/server";
import { getHeadroomStatus } from "open-sse/rtk/headroom.js";

export async function GET() {
  try {
    const status = await getHeadroomStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ installed: false, reachable: false, error: error.message }, { status: 500 });
  }
}
