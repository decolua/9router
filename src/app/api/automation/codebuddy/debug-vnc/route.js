import { NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

const SCREENSHOT_PATH = "/tmp/9router_debug.png";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "screenshot") {
    try {
      const stat = fs.statSync(SCREENSHOT_PATH);
      const age = Date.now() - stat.mtimeMs;
      if (age > 10000) {
        throw new Error("stale");
      }
      const buf = fs.readFileSync(SCREENSHOT_PATH);
      return new Response(buf, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "X-Screenshot-Age": String(Math.round(age)),
        },
      });
    } catch {
      const pixel = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      return new Response(pixel, {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" },
      });
    }
  }

  try {
    const stat = fs.statSync(SCREENSHOT_PATH);
    const age = Date.now() - stat.mtimeMs;
    return NextResponse.json({
      available: age < 10000,
      age: Math.round(age),
    });
  } catch {
    return NextResponse.json({ available: false });
  }
}
