import { NextResponse } from "next/server";
import { ZedService } from "@/lib/oauth/services/zed";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/zed/import
 * Import Zed Hosted AI credentials (user_id + access_token).
 * Stores the long-lived user token the same way RSA OAuth does; LLM bearer
 * tokens are minted on demand by open-sse/shared/zedAuth.js.
 *
 * Request body:
 * - userId: string
 * - accessToken: string — Zed user access token
 */
export async function POST(request) {
  try {
    const { userId, accessToken } = await request.json();

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }
    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "Access token is required" }, { status: 400 });
    }

    const zedService = new ZedService();
    const tokenData = await zedService.validateImportToken(userId.trim(), accessToken.trim());

    const connection = await createProviderConnection({
      provider: "zed",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: null,
      expiresAt: null,
      email: tokenData.email || null,
      displayName: tokenData.name || undefined,
      providerSpecificData: {
        authMethod: "imported",
        userId: tokenData.userId,
        organizationId: tokenData.organizationId || "",
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
    console.log("Zed import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/zed/import
 * Instructions for importing Zed credentials
 */
export async function GET() {
  const zedService = new ZedService();
  const instructions = zedService.getTokenStorageInstructions();

  return NextResponse.json({
    provider: "zed",
    method: "import_token",
    instructions,
    requiredFields: [
      {
        name: "userId",
        label: "User ID",
        description: "Numeric Zed user id from credentials",
        type: "text",
      },
      {
        name: "accessToken",
        label: "Access Token",
        description: "Zed user access token (paired with user id)",
        type: "textarea",
      },
    ],
  });
}
