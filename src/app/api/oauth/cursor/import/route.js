import { NextResponse } from "next/server";
import { CursorService } from "@/lib/oauth/services/cursor";
import { findAndReadCursorLocalAuth } from "@/lib/oauth/services/cursorLocalStore.js";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/cursor/import
 * Import and validate access token from Cursor IDE's local SQLite database
 *
 * Request body:
 * - accessToken: string - Access token from cursorAuth/accessToken
 * - machineId: string - Machine ID from storage.serviceMachineId
 * - cachedEmail: string - Optional email from cursorAuth/cachedEmail
 */
export async function POST(request) {
  try {
    const { accessToken, machineId, cachedEmail: bodyCachedEmail } = await request.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    if (!machineId || typeof machineId !== "string") {
      return NextResponse.json(
        { error: "Machine ID is required" },
        { status: 400 }
      );
    }

    const cursorService = new CursorService();

    // Validate token by making API call
    const tokenData = await cursorService.validateImportToken(
      accessToken.trim(),
      machineId.trim()
    );

    let cachedEmail = typeof bodyCachedEmail === "string" ? bodyCachedEmail.trim() : null;
    if (!cachedEmail) {
      try {
        const localAuth = await findAndReadCursorLocalAuth();
        cachedEmail = localAuth?.cachedEmail || null;
      } catch {
        // Local DB lookup is best-effort.
      }
    }

    const identity = cursorService.resolveIdentity({
      accessToken: tokenData.accessToken,
      cachedEmail,
    });

    // Save to database
    const connection = await createProviderConnection({
      provider: "cursor",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: null, // Cursor doesn't have public refresh endpoint
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: identity.email,
      name: identity.name,
      providerSpecificData: {
        machineId: tokenData.machineId,
        authMethod: "imported",
        provider: "Imported",
        userId: identity.userId,
        ...(identity.email ? { cachedEmail: identity.email } : {}),
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
    console.log("Cursor import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/cursor/import
 * Get instructions for importing Cursor token
 */
export async function GET() {
  const cursorService = new CursorService();
  const instructions = cursorService.getTokenStorageInstructions();

  return NextResponse.json({
    provider: "cursor",
    method: "import_token",
    instructions,
    requiredFields: [
      {
        name: "accessToken",
        label: "Access Token",
        description: "From cursorAuth/accessToken in state.vscdb",
        type: "textarea",
      },
      {
        name: "machineId",
        label: "Machine ID",
        description: "From storage.serviceMachineId in state.vscdb",
        type: "text",
      },
    ],
  });
}
