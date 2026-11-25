import { NextResponse } from "next/server";
import { stopHeadroomProxy } from "@/lib/headroom/process";

import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await stopHeadroomProxy((await getSettings()).headroomUrl || DEFAULT_HEADROOM_URL);
    const status = result.stopped ? 200 : 409;
    return NextResponse.json({ ...result }, { status });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
