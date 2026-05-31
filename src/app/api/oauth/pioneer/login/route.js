import { NextResponse } from "next/server";
import { PioneerService } from "@/lib/oauth/services/pioneer";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/pioneer/login
 *
 * Add Pioneer AI accounts using email + password (Supabase grant_type=password).
 * Accepts either:
 *   { email, password, name?, priority? }                  (single)
 *   { entries: [{email,password}, ...], name?, priority? } (bulk)
 *   { combo: "email:pass\nemail:pass", ... }               (raw paste)
 *
 * For each successful login we mint a fresh pio_sk_ key and persist only
 * that key (not the Supabase session) so the connection remains stable
 * even if the user signs out of Pioneer's web app on another device.
 */
function parseCombo(combo) {
  if (!combo || typeof combo !== "string") return [];
  const out = [];
  for (const raw of combo.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const email = line.slice(0, idx).trim();
    const password = line.slice(idx + 1);
    if (!email || !password) continue;
    out.push({ email, password });
  }
  return out;
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const priority = Number.isFinite(body.priority) ? body.priority : 1;
    const baseName = (body.name || body.displayName || "").trim();
    const captchaToken = (body.captchaToken || "").trim() || null;

    let entries = [];
    if (Array.isArray(body.entries)) {
      entries = body.entries
        .map((e) => ({ email: (e?.email || "").trim(), password: e?.password || "" }))
        .filter((e) => e.email && e.password);
    } else if (typeof body.combo === "string" && body.combo.trim()) {
      entries = parseCombo(body.combo);
    } else if (body.email && body.password) {
      entries = [{ email: String(body.email).trim(), password: String(body.password) }];
    }

    if (entries.length === 0) {
      return NextResponse.json(
        { error: "Provide email + password (single, entries[], or combo string)" },
        { status: 400 }
      );
    }

    const pioneer = new PioneerService();
    const results = [];
    let successCount = 0;
    let captchaRequired = false;

    for (const { email, password } of entries) {
      try {
        const minted = await pioneer.loginAndMintKey(
          email,
          password,
          baseName || `9Router (${email})`,
          captchaToken
        );
        const connection = await createProviderConnection({
          provider: "pioneer",
          authType: "apikey",
          name: baseName ? `${baseName} (${email})` : `Pioneer (${email})`,
          apiKey: minted.apiKey,
          email: minted.email || email,
          priority,
          isActive: true,
          testStatus: "active",
          providerSpecificData: {
            authMethod: "password",
            keySource: "supabase-password",
            keyId: minted.keyId,
          },
        });
        const safe = { ...connection };
        delete safe.apiKey;
        results.push({ email, success: true, connection: safe });
        successCount += 1;
      } catch (e) {
        if (e?.captchaRequired) captchaRequired = true;
        results.push({ email, success: false, error: e.message || "Login failed" });
      }
    }

    if (entries.length === 1) {
      const only = results[0];
      if (!only.success) {
        return NextResponse.json(
          { error: only.error, captchaRequired },
          { status: captchaRequired ? 428 : 401 }
        );
      }
      return NextResponse.json({ success: true, connection: only.connection }, { status: 201 });
    }

    return NextResponse.json({
      success: successCount > 0,
      total: entries.length,
      added: successCount,
      failed: entries.length - successCount,
      captchaRequired,
      results,
    });
  } catch (error) {
    console.log("Pioneer login error:", error);
    return NextResponse.json(
      { error: error.message || "Pioneer login failed" },
      { status: 500 }
    );
  }
}
