import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

/**
 * POST /api/oauth/codex/bulk-import
 * Bulk import multiple codex (OAuth) account JSON objects in one call.
 *
 * Body accepts any of:
 *   - Array:    [{...}, {...}]
 *   - Single:   {...}
 *   - Wrapped:  { accounts: [{...}, ...] }
 *
 * Each item must contain at least `accessToken`. Missing email / chatgpt
 * account info is best-effort backfilled from the JWT (idToken or accessToken).
 *
 * Tokens are NEVER echoed back in the response.
 */
export async function POST(request: NextRequest) {
  let body: JsonValue;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    );
  }

  // Normalize to array
  let accounts: JsonValue[] | null;
  if (Array.isArray(body)) {
    accounts = body;
  } else if (body && typeof body === "object" && !Array.isArray(body) && Array.isArray((body as Record<string, JsonValue>)["accounts"])) {
    accounts = (body as Record<string, JsonValue[]>)["accounts"] ?? null;
  } else if (body && typeof body === "object" && !Array.isArray(body)) {
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

  const results: { index: number; ok: boolean; id?: string; error?: string }[] = [];
  let success = 0;
  let failed = 0;

  // SERIAL loop — createProviderConnection reads max(priority) and reorders
  // inside a transaction. Parallel calls would race on priority assignment.
  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      // Strip server-controlled fields
      const {
        id: _id,
        provider: _provider,
        authType: _authType,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = raw as Record<string, JsonValue>;

      if (!item["accessToken"] || typeof item["accessToken"] !== "string") {
        throw new Error("Missing accessToken");
      }

      // Backfill missing identity fields from JWT claims
      const rawPsd = item["providerSpecificData"];
      const psd: Record<string, JsonValue> = (rawPsd && typeof rawPsd === "object" && !Array.isArray(rawPsd))
        ? { ...(rawPsd as Record<string, JsonValue>) }
        : {};
      const needsEmail = !item["email"];
      const needsAccountId = !psd["chatgptAccountId"];
      const needsPlanType = !psd["chatgptPlanType"];

      if (needsEmail || needsAccountId || needsPlanType) {
        const idToken = typeof item["idToken"] === "string" ? item["idToken"] : item["accessToken"];
        const info = extractCodexAccountInfo(idToken) || {};
        if (needsEmail && info.email) item["email"] = info.email;
        if (needsAccountId && info.chatgptAccountId) {
          psd["chatgptAccountId"] = info.chatgptAccountId;
        }
        if (needsPlanType && info.chatgptPlanType) {
          psd["chatgptPlanType"] = info.chatgptPlanType;
        }
      }
      if (Object.keys(psd).length > 0) {
        item["providerSpecificData"] = psd;
      }

      // Compute expiresAt from expiresIn if absent
      if (!item["expiresAt"] && typeof item["expiresIn"] === "number" && item["expiresIn"] > 0) {
        item["expiresAt"] = new Date(Date.now() + item["expiresIn"] * 1000).toISOString();
      }

      // Defaults aligned with OAuth-completed flow
      if (item["testStatus"] === undefined) item["testStatus"] = "active";
      if (item["isActive"] === undefined) item["isActive"] = true;
      if (!item["lastRefreshAt"]) item["lastRefreshAt"] = new Date().toISOString();

      const created = await createProviderConnection({
        provider: "codex",
        authType: "oauth",
        ...item,
      });

      results.push({ index: i, ok: true, id: created!.id });
      success++;
    } catch (e) {
      results.push({ index: i, ok: false, error: e instanceof Error ? e.message : "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}
