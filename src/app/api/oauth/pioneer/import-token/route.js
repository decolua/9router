import { NextResponse } from "next/server";
import { PioneerService } from "@/lib/oauth/services/pioneer";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/pioneer/import-token
 *
 * Add a Pioneer AI account using a Supabase refresh_token extracted from
 * agent.pioneer.ai's localStorage (key: sb-db-auth-token).
 *
 * The refresh_token is exchanged for a fresh access_token, which is then
 * used to mint a long-lived pio_sk_ key. We persist only the minted API
 * key; the Supabase tokens are not stored to keep the credential surface
 * minimal and stable across user sessions.
 */
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const raw = (body.refreshToken || body.token || "").trim();
    const displayName = (body.name || body.displayName || "").trim();
    const priority = Number.isFinite(body.priority) ? body.priority : 1;

    if (!raw) {
      return NextResponse.json({ error: "Refresh token is required" }, { status: 400 });
    }

    // Accept either the bare refresh_token, or the entire JSON blob a user
    // copied straight out of localStorage (we extract refresh_token from it).
    let refreshToken = raw;
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        refreshToken = parsed.refresh_token || parsed.refreshToken || raw;
      } catch {
        // fall through, treat as raw string
      }
    }

    const pioneer = new PioneerService();
    const minted = await pioneer.refreshAndMintKey(refreshToken, displayName || undefined);

    const connection = await createProviderConnection({
      provider: "pioneer",
      authType: "apikey",
      name: displayName || (minted.email ? `Pioneer (${minted.email})` : "Pioneer AI"),
      apiKey: minted.apiKey,
      email: minted.email || null,
      priority,
      isActive: true,
      testStatus: "active",
      providerSpecificData: {
        authMethod: "import",
        keySource: "supabase-refresh",
        keyId: minted.keyId,
      },
    });

    const safe = { ...connection };
    delete safe.apiKey;
    return NextResponse.json({ success: true, connection: safe }, { status: 201 });
  } catch (error) {
    console.log("Pioneer import-token error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import Pioneer refresh token" },
      { status: 500 }
    );
  }
}
