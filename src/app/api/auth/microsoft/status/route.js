import { NextResponse } from "next/server";
import { MICROSOFT_OAUTH_CONFIG } from "@/lib/auth/microsoft";

export async function GET() {
  return NextResponse.json({
    enabled: MICROSOFT_OAUTH_CONFIG.isEnabled,
    publicClient: MICROSOFT_OAUTH_CONFIG.isPublicClient,
  });
}
