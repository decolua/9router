import { NextResponse } from "next/server";
import { validateAndImportAuth1Token } from "../../../../../lib/oauth/services/devin.js";
import { createProviderConnection } from "@/models";
import { testSingleConnection } from "../../../providers/[id]/test/testUtils.js";

/**
 * POST /api/oauth/devin/import-auth-token
 * Import a Windsurf "auth token" pasted from https://windsurf.com/show-auth-token.
 * Exchanges it via WindsurfPostAuth → devin-session-token, then stores it the
 * same way as a manually-pasted session token. Auto-tests the connection so
 * the dashboard immediately reflects "active" status without a manual click.
 */
export async function POST(request) {
  try {
    const { authToken } = await request.json();

    if (!authToken || typeof authToken !== "string" || authToken.trim().length < 10) {
      return NextResponse.json(
        { error: "A valid Windsurf auth token is required" },
        { status: 400 }
      );
    }

    const { sessionToken, username, email, orgId, teamId } =
      await validateAndImportAuth1Token(authToken.trim());

    const connection = await createProviderConnection({
      provider: "devin",
      authType: "oauth",
      name: username || "Devin",
      email: email || "",
      accessToken: sessionToken,
      refreshToken: null,
      expiresIn: null,
      providerSpecificData: { authMethod: "windsurf_auth_token", orgId, teamId: teamId || "" },
    });

    // Fire-and-update test so the card lands on "active" without a manual click.
    let testStatus = "unknown";
    try {
      const result = await testSingleConnection(connection.id);
      testStatus = result?.valid ? "active" : "error";
    } catch (e) {
      console.warn("Devin auto-test after import failed:", e.message);
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        name: connection.name,
        email: connection.email,
        testStatus,
      },
    });
  } catch (error) {
    console.log("Devin auth-token import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
