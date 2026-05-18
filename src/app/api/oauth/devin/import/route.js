import { NextResponse } from "next/server";
import { validateAndImportKey } from "../../../../../lib/oauth/services/devin.js";
import { createProviderConnection } from "@/models";
import { testSingleConnection } from "../../../providers/[id]/test/testUtils.js";

/**
 * POST /api/oauth/devin/import
 * Import a Devin session token (the JWT from `devin auth login` PKCE exchange).
 * Stores it normalized with "devin-session-token$" prefix so the executor and
 * any future requests can use it directly. Auto-tests the connection so the
 * dashboard reflects "active" without a manual click.
 */
export async function POST(request) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
      return NextResponse.json(
        { error: "A valid Devin session token is required" },
        { status: 400 }
      );
    }

    const trimmed = apiKey.trim();
    const { username, email, orgId } = await validateAndImportKey(trimmed);

    const normalized = trimmed.startsWith("devin-session-token$")
      ? trimmed
      : `devin-session-token$${trimmed}`;

    const connection = await createProviderConnection({
      provider: "devin",
      authType: "oauth",
      name: username || "Devin",
      email: email || "",
      accessToken: normalized,
      refreshToken: null,
      expiresIn: null,
      providerSpecificData: { authMethod: "devin_session_token", orgId },
    });

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
    console.log("Devin import key error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
