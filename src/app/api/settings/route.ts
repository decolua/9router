import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";
import { wasDetected } from "@/lib/headroom/probeCache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"] as const;

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);

    const enableRequestLogs = process.env["ENABLE_REQUEST_LOGS"] === "true";
    const enableTranslator = process.env["ENABLE_TRANSLATOR"] === "true";

    return NextResponse.json(
      { ...safeSettings, enableRequestLogs, enableTranslator, hasPassword: !!password },
      { headers: SETTINGS_RESPONSE_HEADERS }
    );
  } catch (error) {
    console.log("Error getting settings:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Validate boundary: must be a non-null, non-array JSON object.
    const parsed: JsonValue = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }
    const body: Record<string, JsonValue> = { ...parsed };

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    // If updating password, hash it
    if (typeof body["newPassword"] === "string") {
      const newPassword = body["newPassword"];
      const settings = await getSettings();
      const currentHash = typeof settings.password === "string" ? settings.password : "";

      if (currentHash) {
        // Verify current password if one is already set
        const currentPassword = body["currentPassword"];
        if (typeof currentPassword !== "string" || !currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password — allow empty or default "123456"
        const currentPassword = body["currentPassword"];
        if (typeof currentPassword === "string" && currentPassword && currentPassword !== "123456") {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body["password"] = await bcrypt.hash(newPassword, salt);
      delete body["newPassword"];
      delete body["currentPassword"];
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      const secret = body["oidcClientSecret"];
      if (!secret || typeof secret !== "string" || !secret.trim()) {
        delete body["oidcClientSecret"];
      }
    }

    // Auto-classify headroomSource when headroomUrl is patched (without explicit page change)
    if (
      Object.prototype.hasOwnProperty.call(body, "headroomUrl") &&
      !Object.prototype.hasOwnProperty.call(body, "headroomSource")
    ) {
      const headroomUrl = body["headroomUrl"];
      body["headroomSource"] = wasDetected(typeof headroomUrl === "string" ? headroomUrl : "") ? "detected" : "custom";
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
