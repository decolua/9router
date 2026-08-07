import { NextResponse } from "next/server";
import { handleVerify, HttpError } from "@/lib/federation/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET(request) {
  try {
    const payload = await handleVerify(request);
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status, headers: CORS_HEADERS });
    }
    console.error("[federation] verify error:", error);
    return NextResponse.json({ error: "Federation verify failed" }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
