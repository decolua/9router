import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

/**
 * POST /api/oauth/codex/import-token
 * Import a ChatGPT access token (created from chatgpt.com settings)
 * as a provider connection, bypassing OAuth refresh flow.
 *
 * Body: { accessToken: string, name?: string }
 */
export async function POST(request) {
  try {
    const { accessToken, name } = await request.json();

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    const token = accessToken.trim();

    // Extract account info from the JWT (email, workspace, plan)
    let email = null;
    let providerSpecificData = { authMethod: "access_token" };

    // Try decoding as JWT to extract email + workspace
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const missingPadding = (4 - (base64.length % 4)) % 4;
        const padded = base64 + "=".repeat(missingPadding);
        const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));

        // Extract from OpenAI JWT structure
        const auth = payload["https://api.openai.com/auth"] || {};
        const profile = payload["https://api.openai.com/profile"] || {};
        email = profile.email || payload.email || payload.preferred_username || null;

        if (auth.chatgpt_account_id) {
          providerSpecificData.chatgptAccountId = auth.chatgpt_account_id;
        }
        if (auth.chatgpt_plan_type) {
          providerSpecificData.chatgptPlanType = auth.chatgpt_plan_type;
        }

        // Store expiry info from JWT if available
        if (payload.exp) {
          providerSpecificData.jwtExp = payload.exp;
        }
      }
    } catch {
      // Not a JWT or malformed — still allow import as raw token
    }

    // Also try extractCodexAccountInfo via id_token-style extraction
    // (the access token itself may contain the same claims)
    if (!email) {
      const info = extractCodexAccountInfo(token);
      if (info.email) email = info.email;
      if (info.chatgptAccountId) providerSpecificData.chatgptAccountId = info.chatgptAccountId;
      if (info.chatgptPlanType) providerSpecificData.chatgptPlanType = info.chatgptPlanType;
    }

    const connectionName = name || email || "ChatGPT Access Token";

    // Save to database as access_token authType (no refresh token)
    const connection = await createProviderConnection({
      provider: "codex",
      authType: "access_token",
      accessToken: token,
      name: connectionName,
      email: email,
      providerSpecificData,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
        workspace: providerSpecificData.chatgptAccountId || null,
        plan: providerSpecificData.chatgptPlanType || null,
      },
    });
  } catch (error) {
    console.log("Codex access token import error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
