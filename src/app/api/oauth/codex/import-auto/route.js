import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  updateProviderConnection,
} from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { DATA_FILE } from "@/lib/db/paths.js";

const PROVIDER = "codex";
const AUTH_TYPE = "oauth";

/**
 * POST /api/oauth/codex/import-auto
 * Standalone bulk-import endpoint for the auto-login tool. The tool handles
 * login + token exchange entirely and posts the FINAL connection objects here;
 * this route just pushes them into the DB, mirroring the tool's direct-SQLite
 * logic:
 *   - build_data_blob normalization (strip JWT-looking refresh tokens,
 *     reset runtime state: lastUsedAt=now, consecutiveUseCount/backoffLevel=0)
 *   - dedupe by email (case-insensitive): existing email → replace tokens in
 *     place (keep priority), new email → append at max(priority)+1
 *   - returns { sqliteVerified, errors, ... } so the tool can confirm the write
 *
 * Body accepts: { connections: [...] }, a bare array, a single object, or the
 * legacy { accounts: [...] } shape.
 *
 * Tokens are NEVER echoed back in the response.
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

  // Normalize to an array of connection objects.
  let items;
  if (Array.isArray(body)) {
    items = body;
  } else if (body && typeof body === "object" && Array.isArray(body.connections)) {
    items = body.connections;
  } else if (body && typeof body === "object" && Array.isArray(body.accounts)) {
    items = body.accounts;
  } else if (body && typeof body === "object") {
    items = [body];
  } else {
    items = null;
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No connections provided" }, { status: 400 });
  }

  // email → existing connection map (queried once).
  const list = await getProviderConnections({ provider: PROVIDER });
  const byEmail = new Map();
  for (const c of list) {
    const key = (c.email || "").toLowerCase().trim();
    if (key && !byEmail.has(key)) byEmail.set(key, c);
  }

  const results = [];
  let inserted = 0;
  let replaced = 0;
  let failed = 0;

  // SERIAL loop — create/update mutate priorities inside a transaction.
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      // Strip server-controlled fields.
      const {
        id: _id,
        provider: _provider,
        authType: _authType,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        priority: _priority,
        ...item
      } = raw;

      if (!item.accessToken || typeof item.accessToken !== "string") {
        throw new Error("Missing accessToken");
      }

      // Backfill missing identity fields from the JWT (idToken or accessToken).
      const psd = item.providerSpecificData || {};
      const needsEmail = !item.email;
      const needsAccountId = !psd.chatgptAccountId;
      const needsPlanType = !psd.chatgptPlanType;
      if (needsEmail || needsAccountId || needsPlanType) {
        const info = extractCodexAccountInfo(item.idToken || item.accessToken) || {};
        if (needsEmail && info.email) item.email = info.email;
        if (needsAccountId && info.chatgptAccountId) psd.chatgptAccountId = info.chatgptAccountId;
        if (needsPlanType && info.chatgptPlanType) psd.chatgptPlanType = info.chatgptPlanType;
      }
      if (Object.keys(psd).length > 0) item.providerSpecificData = psd;

      // expiresAt from expiresIn when absent.
      if (!item.expiresAt && typeof item.expiresIn === "number" && item.expiresIn > 0) {
        item.expiresAt = new Date(Date.now() + item.expiresIn * 1000).toISOString();
      }

      // build_data_blob contract (matches the tool's direct SQLite push).
      const now = new Date().toISOString();
      if (typeof item.refreshToken === "string" && item.refreshToken.startsWith("eyJ")) {
        item.refreshToken = "";
      }
      if (typeof item.expiresIn !== "number" || !Number.isFinite(item.expiresIn)) {
        item.expiresIn = 0;
      }
      if (!item.lastUsedAt) item.lastUsedAt = now;
      item.consecutiveUseCount = 0;
      item.backoffLevel = 0;
      if (item.lastError === undefined) item.lastError = null;
      if (item.lastErrorAt === undefined) item.lastErrorAt = null;

      if (item.testStatus === undefined) item.testStatus = "active";
      if (item.isActive === undefined) item.isActive = true;
      if (!item.lastRefreshAt) item.lastRefreshAt = now;

      const emailKey = (item.email || "").toLowerCase().trim();
      const existing = emailKey ? byEmail.get(emailKey) : null;

      if (existing) {
        // Replace tokens in place, preserving id + priority.
        await updateProviderConnection(existing.id, {
          accessToken: item.accessToken,
          refreshToken: item.refreshToken !== undefined ? item.refreshToken : existing.refreshToken,
          idToken: item.idToken !== undefined ? item.idToken : existing.idToken,
          expiresAt: item.expiresAt !== undefined ? item.expiresAt : existing.expiresAt,
          expiresIn: item.expiresIn !== undefined ? item.expiresIn : existing.expiresIn,
          email: item.email !== undefined ? item.email : existing.email,
          name: item.name !== undefined ? item.name : existing.name,
          testStatus: item.testStatus,
          isActive: item.isActive,
          providerSpecificData:
            item.providerSpecificData !== undefined
              ? item.providerSpecificData
              : existing.providerSpecificData,
          lastRefreshAt: item.lastRefreshAt,
          lastUsedAt: item.lastUsedAt,
          consecutiveUseCount: item.consecutiveUseCount,
          backoffLevel: item.backoffLevel,
          lastError: item.lastError,
          lastErrorAt: item.lastErrorAt,
        });
        replaced++;
        results.push({ index: i, ok: true, id: existing.id, action: "replaced" });
      } else {
        const created = await createProviderConnection({
          provider: PROVIDER,
          authType: AUTH_TYPE,
          ...item,
        });
        inserted++;
        results.push({ index: i, ok: true, id: created.id, action: "inserted" });
        const createdKey = (created.email || "").toLowerCase().trim();
        if (createdKey) byEmail.set(createdKey, created);
      }
    } catch (e) {
      failed++;
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
    }
  }

  // Verify: every incoming email must now exist in the codex connection set.
  const allConns = await getProviderConnections({ provider: PROVIDER });
  const emailsInDb = new Set(
    allConns.map((c) => (c.email || "").toLowerCase().trim()).filter(Boolean)
  );
  const expectedEmails = [
    ...new Set(
      items
        .map((a) => (a && (a.email || a.name)) || "")
        .map((e) => e.toLowerCase().trim())
        .filter(Boolean)
    ),
  ];
  const missingEmails = expectedEmails.filter((e) => !emailsInDb.has(e));
  const verifiedEmails = expectedEmails.filter((e) => emailsInDb.has(e));
  const sqliteVerified = missingEmails.length === 0;

  const errors = missingEmails.map((e) => `Email not found after import: ${e}`);
  for (const r of results) {
    if (!r.ok) errors.push(`[item ${r.index}] ${r.error}`);
  }

  return NextResponse.json(
    {
      inserted,
      replaced,
      failed,
      total: inserted + replaced,
      sqliteVerified,
      verifiedEmails,
      errors,
      results,
      sqlitePath: DATA_FILE,
    },
    { status: sqliteVerified ? 200 : 500 }
  );
}
