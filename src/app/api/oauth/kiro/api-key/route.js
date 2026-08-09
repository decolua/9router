import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/kiro/api-key
 * Import a Kiro API key (headless auth). The key is a long-lived bearer
 * credential — there is no refresh token. It is validated against the Amazon
 * Q model catalog, then stored with authMethod="api_key".
 */
export async function POST(request) {
  try {
    const { apiKey, region } = await request.json();

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();

    // Validate the key against the same Amazon Q surface used for inference.
    const credential = await kiroService.validateApiKey(
      apiKey,
      region || "auto"
    );

    // Extract email from JWT if the key happens to be a JWT (optional display)
    const email = kiroService.extractEmailFromJWT(credential.accessToken);

    // API keys never expire on a fixed schedule; persist a long horizon so the
    // proactive refresh path (which requires a refreshToken anyway) is skipped.
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "api_key",
      accessToken: credential.accessToken,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        ...(credential.profileArn ? { profileArn: credential.profileArn } : {}),
        region: credential.region,
        authMethod: "api_key",
        provider: "API Key",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro API key import error:", error);
    // Do not reflect upstream response body to the client (SSRF hardening)
    return NextResponse.json(
      { error: "API key validation failed" },
      { status: 500 }
    );
  }
}
