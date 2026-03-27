import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join, dirname } from "path";

const bin9remote = join(dirname(process.execPath), "9remote");
const AGENT_URL = "http://localhost:2208";

async function isRunning() {
  try {
    const res = await fetch(`${AGENT_URL}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const running = await isRunning();
  if (running) return NextResponse.json({ installed: true, running: true });

  const installed = existsSync(bin9remote);
  return NextResponse.json({ installed, running: false });
}
