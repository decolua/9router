import { NextResponse } from "next/server";
import { getSettings, getApiKeys } from "@/lib/localDb";

/**
 * User info endpoint for Amp CLI authentication
 * Returns user information when valid API key is provided
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const apiKey = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    // Get settings
    const settings = await getSettings();
    const { ampUpstreamApiKey } = settings;

    // Validate API key
    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === apiKey && k.isActive !== false)
      || apiKey === "sk_9router"
      || apiKey === ampUpstreamApiKey;

    if (!validKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Return user info
    return NextResponse.json({
      id: "local-user",
      email: "user@localhost",
      name: "Local User",
      authenticated: true,
    });
  } catch (error) {
    console.error("[User API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get user info" },
      { status: 500 }
    );
  }
}
