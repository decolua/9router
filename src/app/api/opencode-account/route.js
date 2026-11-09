import { NextResponse } from "next/server";
import {
  startDeviceAuth,
  pollDeviceAuth,
  getAccountStatus,
  clearAccount,
} from "@/lib/opencodeAccount";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await getAccountStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ connected: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const action = body?.action || "";

  try {
    if (action === "start") {
      return NextResponse.json(await startDeviceAuth(), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (action === "poll") {
      const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
      if (!deviceCode) return NextResponse.json({ error: "deviceCode required" }, { status: 400 });
      return NextResponse.json(await pollDeviceAuth(deviceCode), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (action === "logout") {
      await clearAccount();
      return NextResponse.json({ connected: false }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "request failed" }, { status: 502 });
  }
}
