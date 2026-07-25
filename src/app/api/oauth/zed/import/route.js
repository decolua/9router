import { NextResponse } from "next/server";
import { ZedService } from "@/lib/oauth/services/zed";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/zed/import
 * Import Zed Hosted AI credentials (user_id + access_token) and mint an LLM token.
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
      accessToken: tokenData.llmToken,
      refreshToken: tokenData.accessToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: tokenData.email || null,
      providerSpecificData: {
        userId: tokenData.userId,
        zedAccessToken: tokenData.accessToken,
        organizationId: tokenData.organizationId,
        authMethod: "imported",
        provider: "Imported",
        llmToken: tokenData.llmToken,
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
