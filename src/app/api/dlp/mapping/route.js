import { NextResponse } from "next/server";
import { getMapping, clearMapping } from "open-sse/dlp/pseudonyms.js";

// auth: same as /api/settings — dashboard API routes carry no session guard here
export async function GET() {
  try {
    return NextResponse.json(getMapping(500));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const cleared = clearMapping();
    return NextResponse.json({ cleared });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}