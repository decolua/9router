import { NextResponse } from "next/server";
import { getSettings, getProviderConnections } from "@/lib/localDb";
import { checkWarpHealth, probeWarpTrace } from "@/lib/network/warpHealth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const settings = await getSettings();
    const dto = await checkWarpHealth({
      settings,
      listConnections: getProviderConnections,
      probe: probeWarpTrace,
    });
    return NextResponse.json(dto, { headers: HEADERS });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 500, headers: HEADERS });
  }
}
