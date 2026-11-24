import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { startHeadroomProxy } from "@/lib/headroom/process";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const result = await startHeadroomProxy({
      url,
      codeAware: settings.headroomCodeAware === true,
      kompress: settings.headroomKompress !== false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const status = ["NOT_INSTALLED", "EXTERNAL_PROXY"].includes(error.code) ? 400 : 500;
    return NextResponse.json({ error: error.message, code: error.code || null }, { status });
  }
}
