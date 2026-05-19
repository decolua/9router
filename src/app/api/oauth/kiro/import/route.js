import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { collectRefreshTokens, maskToken } from "./helpers";

/**
 * POST /api/oauth/kiro/import
 *
 * Accepts a single refresh token or many at once. The single-token shape is
 * preserved for backwards compatibility with older clients.
 *
 * Request shapes:
 *   { "refreshToken": "aorAAAAAG..." }
 *   { "refreshTokens": ["aorAAAAAG...", "aorAAAAAG..."] }
 *   { "refreshTokens": "aorAAAAAG...\naorAAAAAG..." }   // newline / whitespace / comma / semicolon separated
 *
 * Response (200 when at least one token was imported, 422 otherwise):
 *   {
 *     success: boolean,
 *     imported: [{ id, email, refreshToken: "<masked>" }],
 *     failed:   [{ refreshToken: "<masked>", error: string }],
 *     // Single-token success path also includes `connection` for backwards compat.
 *     connection?: { id, provider, email }
 *   }
 */
export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tokens = collectRefreshTokens(payload);
  if (tokens.length === 0) {
    return NextResponse.json(
      { error: "Refresh token is required" },
      { status: 400 }
    );
  }

  const kiroService = new KiroService();
  // Validate + persist each token in parallel. One bad token must not block
  // the rest.
  const results = await Promise.all(
    tokens.map((rt) => importOne(rt, kiroService))
  );

  const imported = [];
  const failed = [];
  for (const r of results) {
    if (r.ok) imported.push(r.payload);
    else failed.push(r.payload);
  }

  const wasSingle = tokens.length === 1 && !Array.isArray(payload?.refreshTokens);
  const success = imported.length > 0;

  const body = { success, imported, failed };
  if (wasSingle && success) {
    // Preserve the legacy single-token response shape so existing clients keep
    // working without changes.
    body.connection = {
      id: imported[0].id,
      provider: "kiro",
      email: imported[0].email,
    };
  }

  return NextResponse.json(body, { status: success ? 200 : 422 });
}

/**
 * Validate and persist a single refresh token. Failures are returned (not
 * thrown) so `Promise.all` won't short-circuit when one token is bad.
 */
async function importOne(refreshToken, kiroService) {
  const masked = maskToken(refreshToken);
  try {
    const tokenData = await kiroService.validateImportToken(refreshToken);
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: "imported",
        provider: "Imported",
      },
      testStatus: "active",
    });

    return {
      ok: true,
      payload: {
        id: connection.id,
        email: connection.email,
        refreshToken: masked,
      },
    };
  } catch (error) {
    console.log("Kiro import token error:", error?.message || error);
    return {
      ok: false,
      payload: {
        refreshToken: masked,
        error: error?.message || String(error),
      },
    };
  }
}
