import { NextResponse } from "next/server"
import crypto from "crypto"
import { CursorService } from "@/lib/oauth/services/cursor"
import { createProviderConnection } from "@/models"

/**
 * POST /api/oauth/cursor/import-apikey
 *
 * Import a Cursor "user API key" (`key_...`) and exchange it for a JWT.
 *
 * Why this exists:
 *   The legacy /api/oauth/cursor/import flow stores the JWT extracted from
 *   Cursor IDE's local SQLite. That JWT expires after ~1h and there is no
 *   refresh path without Cursor IDE running (the IDE renews the row
 *   in state.vscdb internally).
 *
 *   This route stores the long-lived `key_...` instead, allowing the
 *   CursorExecutor.refreshCredentials() to mint a fresh JWT on demand
 *   by re-calling POST https://api2.cursor.sh/auth/exchange_user_api_key
 *   — the exact same mechanism cursor-agent CLI uses internally.
 *
 * Request body:
 *   - apiKey: string  (long-lived Cursor user API key, starts with "key_")
 *   - label?: string  (optional display name for the connection)
 *   - machineId?: string  (optional; auto-generated UUID if absent)
 */
export async function POST(request) {
  try {
    const { apiKey, label, machineId: providedMachineId } = await request.json()

    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 })
    }

    const key = apiKey.trim()
    if (!key.startsWith("crsr_")) {
      return NextResponse.json(
        { error: "Invalid Cursor API key format (expected to start with 'crsr_')" },
        { status: 400 }
      )
    }

    // 1. Exchange API key for an initial JWT to validate.
    const res = await fetch("https://api2.cursor.sh/auth/exchange_user_api_key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: "{}",
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return NextResponse.json(
        { error: `Cursor rejected the API key (HTTP ${res.status}): ${text.slice(0, 200)}` },
        { status: 401 }
      )
    }

    const data = await res.json()
    const accessToken = data?.accessToken
    const refreshToken = data?.refreshToken || null
    if (!accessToken) {
      return NextResponse.json(
        { error: "Cursor response missing accessToken" },
        { status: 502 }
      )
    }

    // 2. Decode JWT exp for accurate expiresAt; fall back to 1h.
    let expSeconds = Math.floor(Date.now() / 1000) + 3600
    try {
      const decoded = JSON.parse(
        Buffer.from(accessToken.split(".")[1], "base64").toString()
      )
      if (Number.isFinite(decoded?.exp)) expSeconds = decoded.exp
    } catch {
      // non-JWT token, keep fallback
    }

    // 3. Try to extract identity (email / sub) from JWT for connection naming
    //    & dedup by email inside createProviderConnection.
    const cursorService = new CursorService()
    const userInfo = cursorService.extractUserInfo(accessToken)

    // 4. machineId: API-key flow has no real serviceMachineId — generate a
    //    stable random UUID per connection. Cursor's checksum header only
    //    needs a UUID-shaped value; the server does not bind it to anything.
    const machineId =
      (providedMachineId && providedMachineId.trim()) || crypto.randomUUID()

    // 5. Persist. The long-lived `apiKey` lives in providerSpecificData so
    //    CursorExecutor.refreshCredentials() can re-exchange it on 401/403.
    const connection = await createProviderConnection({
      provider: "cursor",
      authType: "oauth",
      accessToken,
      refreshToken,
      expiresAt: new Date(expSeconds * 1000).toISOString(),
      email: userInfo?.email || (label ? label.trim() : null),
      providerSpecificData: {
        machineId,
        apiKey: key,
        authMethod: "apikey",
        provider: "API Key",
        userId: userInfo?.userId || null,
      },
      testStatus: "active",
    })

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    })
  } catch (error) {
    console.log("Cursor import-apikey error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
