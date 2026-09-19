import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";
import { isContainerDeploy } from "@/lib/deployMode";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    const managedPid = getManagedPid();
    // Container images ship no Python and /api/headroom/start is loopback-only,
    // so managed mode can never start there — only an external proxy URL works.
    const containerDeploy = isContainerDeploy();
    return NextResponse.json({
      ...status,
      canStart: status.canStart && !containerDeploy,
      containerDeploy,
      url,
      managedPid,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
