import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "@/lib/oauth/providerHelpers";

/**
 * POST /api/oauth/grok-cli/bulk-import
 * Bulk import multiple Grok CLI (OAuth/Device) account JSON objects in one call.
 *
 * Body accepts any of:
 *   - Array:    [{...}, {...}]
 *   - Single:   {...}
 *   - Wrapped:  { accounts: [{...}, ...] }
 *
 * Each item accepts snake_case or camelCase:
 *   access_token / accessToken
 *   refresh_token / refreshToken
 *   id_token / idToken
 *   email
 *   expires_in / expiresIn / expires_at / expiresAt
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err.message}` },
      { status: 400 }
    );
  }

  let accounts;
  if (Array.isArray(body)) {
    accounts = body;
  } else if (body && typeof body === "object" && Array.isArray(body.accounts)) {
    accounts = body.accounts;
  } else if (body && typeof body === "object") {
    accounts = [body];
  } else {
    accounts = null;
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json(
      { error: "No accounts provided" },
      { status: 400 }
    );
  }

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      const accessToken = raw.access_token || raw.accessToken;
      const refreshToken = raw.refresh_token || raw.refreshToken || null;
      const idToken = raw.id_token || raw.idToken || null;
      let email = raw.email || null;

      if (!accessToken || typeof accessToken !== "string") {
        throw new Error("Missing access_token / accessToken");
      }

      if (!email) {
        email =
          decodeXaiIdTokenEmail(idToken) ||
          extractEmailFromAccessToken(accessToken) ||
          null;
      }

      let expiresAt = raw.expires_at || raw.expiresAt || null;
      const expiresIn = raw.expires_in || raw.expiresIn;
      if (!expiresAt && typeof expiresIn === "number" && expiresIn > 0) {
        expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      }

      const psd = {
        authMethod: "device_code",
        ...(idToken ? { idToken } : {}),
        ...(email ? { email } : {}),
        ...(raw.providerSpecificData || {}),
      };

      const created = await createProviderConnection({
        provider: "grok-cli",
        authType: "oauth",
        accessToken,
        refreshToken,
        expiresAt,
        email,
        displayName: raw.displayName || raw.name || undefined,
        providerSpecificData: psd,
        testStatus: "active",
      });

      success++;
      results.push({ index: i, ok: true, id: created.id, email: created.email });
    } catch (err) {
      failed++;
      results.push({ index: i, ok: false, error: err.message });
    }
  }

  return NextResponse.json({
    total: accounts.length,
    success,
    failed,
    results,
  });
}
