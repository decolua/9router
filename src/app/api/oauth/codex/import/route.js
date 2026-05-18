import { NextResponse } from "next/server";
import {
  normalizeCodexImportRecord,
  flattenCodexImportPayload,
} from "@/lib/oauth/services/codexImport";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/codex/import
 *
 * Body:
 *   { accounts: object | object[] }
 *
 * Each account is the raw JSON record produced by codex CLI / token-exporter
 * tools (id_token, access_token, refresh_token, account_id, email, expired, ...).
 * Returns a per-record summary so partial successes are surfaced to the UI.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid or empty JSON body" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || body.accounts === undefined) {
    return NextResponse.json(
      { error: "Body must include `accounts` (object or array)" },
      { status: 400 },
    );
  }

  const flat = flattenCodexImportPayload(body.accounts);
  if (!flat.ok) {
    return NextResponse.json({ error: flat.error }, { status: 400 });
  }
  if (flat.records.length === 0) {
    return NextResponse.json(
      { error: "No accounts found in payload" },
      { status: 400 },
    );
  }

  const results = [];
  let imported = 0;
  let failed = 0;

  for (let i = 0; i < flat.records.length; i++) {
    const norm = normalizeCodexImportRecord(flat.records[i]);
    if (!norm.ok) {
      failed += 1;
      results.push({ index: i, ok: false, error: norm.error });
      continue;
    }
    try {
      const conn = await createProviderConnection(norm.payload);
      imported += 1;
      results.push({
        index: i,
        ok: true,
        connectionId: conn.id,
        email: conn.email,
      });
    } catch (error) {
      failed += 1;
      results.push({
        index: i,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    success: failed === 0,
    imported,
    failed,
    total: flat.records.length,
    results,
  });
}
