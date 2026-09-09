import { NextResponse } from "next/server";
import { testMask } from "open-sse/dlp/index.js";

// auth: same as /api/settings — dashboard API routes carry no session guard here
export async function POST(request) {
  try {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ valid: false, error: "Invalid JSON body" }, { status: 400 });
    }
    const { type = "regex", pattern = "", flags = "", sampleText = "" } = payload || {};
    if (!pattern) {
      return NextResponse.json(
        { valid: false, error: "pattern is required", matches: [], preview: sampleText },
        { status: 400 }
      );
    }
    return NextResponse.json(testMask({ type, pattern, flags, sampleText }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
