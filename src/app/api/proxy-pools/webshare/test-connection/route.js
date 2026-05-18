import { NextResponse } from "next/server";
import { getProfile } from "@/lib/webshare/webshareClient.js";

export async function POST(request) {
  try {
    const body = await request.json();
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "apiKey required" });
    }

    const profile = await getProfile(apiKey);

    return NextResponse.json({
      ok: true,
      profile: {
        email: profile?.email ?? null,
      },
    });
  } catch (error) {
    console.log("Error testing Webshare connection:", error?.name ?? "unknown");
    const isAuthError = error?.name === "WebshareAuthError";
    const isRateLimit = error?.name === "WebshareRateLimitError";
    const message = isAuthError ? "Authentication failed" : isRateLimit ? "Rate limit exceeded" : "Connection failed";
    return NextResponse.json({ ok: false, error: message });
  }
}
