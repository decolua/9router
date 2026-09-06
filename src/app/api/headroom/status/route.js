import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus, getInstalledHeadroomExtras } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";

export const dynamic = "force-dynamic";

// /v1/compress exists since headroom-ai 0.5.21; an older install must re-run the
// install action (or upgrade) before compression can work.
const COMPRESS_VERSION_FLOOR = [0, 5, 21];

function isCompressCapable(version) {
  if (!version) return false;
  const parts = String(version)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < COMPRESS_VERSION_FLOOR.length; i++) {
    const a = parts[i] || 0;
    const b = COMPRESS_VERSION_FLOOR[i];
    if (a !== b) return a > b;
  }
  return true;
}

export async function GET() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    const managedPid = getManagedPid();
    const extras = getInstalledHeadroomExtras();
    return NextResponse.json({ ...status, url, managedPid, compressCapable: isCompressCapable(extras.version) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
