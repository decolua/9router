import { NextResponse } from "next/server";
import { getSettings, getApiKeys } from "@/lib/localDb";

function extractToken(request) {
  const authHeader = request.headers.get("authorization");
  return authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
}

export async function GET(request) {
  try {
    const token = extractToken(request);
    if (!token) {
      return NextResponse.json({ error: "Authorization required" }, { status: 401 });
    }

    const settings = await getSettings();
    const { ampUpstreamApiKey } = settings;

    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === token && k.isActive !== false)
      || token === "sk_9router"
      || token === ampUpstreamApiKey;

    if (!validKey) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: "local-user",
        email: "user@localhost",
        name: "Local User",
      },
      server: "9router",
    });
  } catch (error) {
    console.error("[Amp Meta API] Error:", error);
    return NextResponse.json({ error: error.message || "Failed to get metadata" }, { status: 500 });
  }
}
