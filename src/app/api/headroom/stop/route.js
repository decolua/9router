import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, isLoopbackHeadroomUrl, parsePortFromUrl } from "@/lib/headroom/detect";
import { stopHeadroomProxy } from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      return NextResponse.json(
        { error: "External Headroom proxies must be stopped outside 9Router", code: "EXTERNAL_PROXY" },
        { status: 400 },
      );
    }
    const port = parsePortFromUrl(url);
    const result = stopHeadroomProxy({ port });
    const status = result.stopped ? 200 : 409;
    return NextResponse.json({ ...result }, { status });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code || null }, { status: 500 });
  }
}
