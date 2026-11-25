import { isCompressionProfile } from "open-sse/config/compressionProfiles.js";
import { validateHeadroomUrl } from "@/lib/headroom/transport.js";
import { audit, auditActor } from "@/lib/observability/audit";
import { ACCOUNT_STRATEGIES } from "@/shared/constants/accountRouting";
import { normalizeRoleList } from "@/lib/auth/dashboardRoles";
import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { requireDashboardAdmin } from "@/dashboardGuard";
import { validRetention } from "@/lib/db/logRetention";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted", "sessionEpoch", "debugBodyLoggingUntil", "canManageLogs"];

export async function GET(request) {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      canManageLogs: !!request?.cookies && !(await requireDashboardAdmin(request, { requireCredential: true })),
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    if (Object.hasOwn(body, "compressionProfile") && !isCompressionProfile(body.compressionProfile))
      return NextResponse.json({ error: "Invalid compression profile" }, { status: 400 });
    if (Object.hasOwn(body, "headroomUrl")) {
      try { validateHeadroomUrl(body.headroomUrl); }
      catch { return NextResponse.json({ error: "Expected a loopback or public HTTP(S) Headroom URL" }, { status: 400 }); }
    }

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    for (const key of ["ssoAdminEmails", "ssoAdminGroups"]) {
      if (!Object.hasOwn(body, key)) continue;
      const list = normalizeRoleList(body[key], key === "ssoAdminEmails");
      if (!list) return NextResponse.json({ error: key + " must be a list of strings" }, { status: 400 });
      body[key] = list;
    }

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const { providerRouting, ...updates } = body;
    if (providerRouting !== undefined && (!providerRouting || typeof providerRouting.provider !== "string" ||
        !/^[a-z0-9][a-z0-9._-]*$/i.test(providerRouting.provider) ||
        Object.hasOwn(Object.prototype, providerRouting.provider) ||
        !(providerRouting.strategy === "" || Object.hasOwn(ACCOUNT_STRATEGIES, providerRouting.strategy)) ||
        (providerRouting.strategy === "round-robin" && !(Number.isSafeInteger(providerRouting.stickyLimit) && providerRouting.stickyLimit > 0)))) {
      return NextResponse.json({ error: "Invalid provider routing settings" }, { status: 400 });
    }
    if ("auditRetentionDays" in updates && !validRetention(updates.auditRetentionDays))
      return NextResponse.json({ error: "auditRetentionDays must be an integer from 1 to 3650" }, { status: 400 });
    const identity = await auditActor(request);
    const settings = await updateSettings(updates, { providerRouting });

    if (Object.hasOwn(updates, "password")) await audit(request, "password.change", { identity });
    if (Object.keys(body).length) await audit(request, "settings.update", { identity, fields: Object.keys(body) });

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

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
