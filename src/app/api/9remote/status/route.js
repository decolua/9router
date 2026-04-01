import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { getNineRemoteServerUrl, isNineRemoteEnabled } from "@/lib/nineRemoteConfig";

const bin9remote = join(dirname(process.execPath), "9remote");

async function isRunning() {
  try {
    const res = await fetch(`${getNineRemoteServerUrl()}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  if (!isNineRemoteEnabled()) {
    return NextResponse.json({ enabled: false, installed: false, running: false }, { status: 404 });
  }

  const running = await isRunning();
  if (running) return NextResponse.json({ enabled: true, installed: true, running: true });

  const installed = existsSync(bin9remote);
  return NextResponse.json({ enabled: true, installed, running: false });
}
