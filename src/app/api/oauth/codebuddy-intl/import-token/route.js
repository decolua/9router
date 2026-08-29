import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

const CODEBUDDY_ISSUER = "https://www.codebuddy.ai/auth/realms/copilot";

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Token is not a valid JWT");
  }

  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  return JSON.parse(
    Buffer.from(padded, "base64").toString("utf8")
  );
}

function audienceContainsAccount(aud) {
  if (Array.isArray(aud)) return aud.includes("account");
  return aud === "account";
}

/**
 * POST /api/oauth/codebuddy-intl/import-token
 *
 * Import a CodeBuddy Keycloak JWT as an OAuth access-token connection.
 *
 * Body:
 * {
 *   accessToken: string,
 *   name?: string
 * }
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

    let payload;

    try {
      payload = decodeJwtPayload(token);
    } catch {
      return NextResponse.json(
        { error: "Invalid CodeBuddy JWT" },
        { status: 400 }
      );
    }

    if (payload.iss !== CODEBUDDY_ISSUER) {
      return NextResponse.json(
        {
          error: "JWT issuer is not CodeBuddy Keycloak",
        },
        { status: 400 }
      );
    }

    if (!audienceContainsAccount(payload.aud)) {
      return NextResponse.json(
        {
          error: "JWT audience does not contain account",
        },
        { status: 400 }
      );
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp <= now) {
      return NextResponse.json(
        { error: "CodeBuddy JWT is expired" },
        { status: 400 }
      );
    }

    const email =
      payload.email ||
      payload.preferred_username ||
      null;

    const connectionName =
      name ||
      email ||
      "CodeBuddy Keycloak JWT";

    const providerSpecificData = {
      authMethod: "access_token",
      issuer: payload.iss,
      audience: payload.aud,
      authorizedParty: payload.azp || null,
      jwtExp: payload.exp || null,
      scope: payload.scope || null,
      keycloak: true,
    };

    const connection = await createProviderConnection({
      provider: "codebuddy-intl",
      authType: "access_token",
      accessToken: token,
      name: connectionName,
      email,
      providerSpecificData,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        email: connection.email,
        expiresAt: payload.exp
          ? new Date(payload.exp * 1000).toISOString()
          : null,
        authType: "access_token",
      },
    });
  } catch (error) {
    console.log("CodeBuddy access token import error:", error);

    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}
