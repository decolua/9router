import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus, parsePortFromUrl } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    const port = parsePortFromUrl(url);
    const managedPid = getManagedPid(port);
    return NextResponse.json({ ...status, url, managedPid });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
