import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createProviderConnection } from "@/models";
import {
  fetchZedAuthenticatedUser,
  resolveZedOrganizationId,
} from "open-sse/shared/zedAuth.js";

/**
 * POST /api/oauth/zed/import
 * Validate + save a Zed session (typically from IDE auto-import).
 *
 * Body: { accessToken, userId, systemId? }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
    const userId = body?.userId != null ? String(body.userId).trim() : "";
    const systemId =
      (typeof body?.systemId === "string" && body.systemId.trim()) || randomUUID();

    if (!accessToken) {
      return NextResponse.json({ error: "Access token is required" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const credentials = {
      accessToken,
      providerSpecificData: { userId, systemId },
    };

    let userInfo = null;
    try {
      userInfo = await fetchZedAuthenticatedUser(credentials);
    } catch (err) {
      return NextResponse.json(
        { error: err.message || "Zed token validation failed" },
        { status: 401 },
      );
    }

    const organizationId = resolveZedOrganizationId(credentials, userInfo);
    const email = userInfo?.email || null;
    const displayName =
      userInfo?.name || userInfo?.display_name || userInfo?.username || `Zed ${userId}`;

    const connection = await createProviderConnection({
      provider: "zed",
      authType: "oauth",
      accessToken,
      refreshToken: null,
      expiresAt: null,
      email,
      displayName,
      providerSpecificData: {
        authMethod: "imported",
        userId,
        systemId,
        organizationId: organizationId || "",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        displayName: connection.displayName,
      },
    });
  } catch (error) {
    console.log("Zed import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
