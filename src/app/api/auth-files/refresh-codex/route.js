import { NextResponse } from "next/server";
import { CODEX_CONFIG } from "@/lib/oauth/constants/oauth";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { getProviderConnectionById, updateProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Connection id is required" }, { status: 400 });

    const connection = await getProviderConnectionById(id);
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    if (connection.provider !== "codex") return NextResponse.json({ error: "Only Codex connections can be refreshed here" }, { status: 400 });
    if (!connection.refreshToken) return NextResponse.json({ error: "No refresh token stored for this connection" }, { status: 400 });

    const response = await fetch(CODEX_CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CODEX_CONFIG.clientId,
        refresh_token: connection.refreshToken,
        scope: CODEX_CONFIG.scope,
      }),
    });

    const text = await response.text();
    const tokens = text ? JSON.parse(text) : {};

    if (!response.ok) {
      return NextResponse.json({ error: tokens.error_description || tokens.error || text || "Refresh token failed" }, { status: response.status });
    }

    const patch = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || connection.refreshToken,
      idToken: tokens.id_token || connection.idToken,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : connection.expiresAt,
      tokenType: tokens.token_type || connection.tokenType,
      scope: tokens.scope || connection.scope,
      testStatus: "active",
      isActive: true,
      lastError: null,
      lastErrorAt: null,
    };

    const info = extractCodexAccountInfo(patch.idToken);
    if (info.email) patch.email = info.email;
    if (info.chatgptAccountId || info.chatgptPlanType) {
      patch.providerSpecificData = {
        ...(connection.providerSpecificData || {}),
        chatgptAccountId: info.chatgptAccountId,
        chatgptPlanType: info.chatgptPlanType,
      };
    }

    await updateProviderConnection(id, patch);

    return NextResponse.json({ ok: true, expiresAt: patch.expiresAt });
  } catch (error) {
    console.log("Error refreshing Codex token:", error);
    return NextResponse.json({ error: error.message || "Failed to refresh Codex token" }, { status: 500 });
  }
}