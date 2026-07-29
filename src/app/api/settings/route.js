import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getEffectiveSettings, updateUserSettings } from "@/lib/db/repos/userSettingsRepo.js";
import { updateUser } from "@/lib/db/repos/usersRepo.js";
import { withAuthUser } from "@/lib/auth/runtimeUserContext.js";
import { USER_SETTINGS_KEYS } from "@/lib/db/migrations/003-multi-user.js";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";
import { validatePassword } from "@/lib/auth/passwordPolicy";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

const ORG_ONLY_KEYS = new Set([
  "cloudEnabled", "tunnelEnabled", "tunnelUrl", "tunnelProvider", "tailscaleEnabled",
  "tailscaleUrl", "requireLogin", "tunnelDashboardAccess", "authMode",
  "oidcIssuerUrl", "oidcClientId", "oidcClientSecret", "oidcScopes", "oidcLoginLabel",
  "outboundProxyEnabled", "outboundProxyUrl", "outboundNoProxy", "mitmRouterBaseUrl",
  "dnsToolEnabled", "rtkEnabled", "prefixCacheEnabled", "cavemanEnabled", "cavemanLevel",
  "compactPoliciesEnabled", "multiUserEnabled", "signupMode",
]);

function sanitizeSettings(settings, { oidcClientSecret }) {
  const { password, oidcClientSecret: secret, ...safeSettings } = settings;
  safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && (secret || oidcClientSecret));
  return safeSettings;
}

export const GET = withAuthUser(async (_request, _ctx, user) => {
  try {
    const effective = await getEffectiveSettings(user.id);
    const org = effective._org || {};
    const { password, oidcClientSecret, ...safeSettings } = effective;
    delete safeSettings._org;
    delete safeSettings._user;

    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";

    const fullUser = await import("@/lib/db/repos/usersRepo.js").then((m) => m.getUserByEmail(user.email));

    return NextResponse.json({
      ...sanitizeSettings(safeSettings, { oidcClientSecret: org.oidcClientSecret || oidcClientSecret }),
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!fullUser?.passwordHash,
      mfaEnabled: !!fullUser?.mfaEnabled,
      currentUser: { id: user.id, email: user.email, name: user.name, role: user.role },
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const PATCH = withAuthUser(async (request, _ctx, user) => {
  try {
    const body = await request.json();

    if (body.newPassword) {
      const passwordCheck = validatePassword(body.newPassword);
      if (!passwordCheck.ok) {
        return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
      }
      const fullUser = await import("@/lib/db/repos/usersRepo.js").then((m) => m.getUserByEmail(user.email));
      if (fullUser?.passwordHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, fullUser.passwordHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }
      await updateUser(user.id, { password: body.newPassword });
      await auditFromRequest(request, {
        action: AuditAction.PASSWORD_CHANGED,
        actorUserId: user.id,
        actorEmail: user.email,
        targetType: "user",
        targetId: user.id,
      });
      delete body.newPassword;
      delete body.currentPassword;
    }

    const orgUpdates = {};
    const userUpdates = {};
    for (const [key, value] of Object.entries(body)) {
      if (ORG_ONLY_KEYS.has(key) || key === "oidcClientSecret") {
        if (user.role !== "admin") continue;
        orgUpdates[key] = value;
      } else if (USER_SETTINGS_KEYS.includes(key)) {
        userUpdates[key] = value;
      } else if (user.role === "admin") {
        orgUpdates[key] = value;
      }
    }

    if (Object.prototype.hasOwnProperty.call(orgUpdates, "oidcClientSecret")) {
      if (!orgUpdates.oidcClientSecret || !String(orgUpdates.oidcClientSecret).trim()) {
        delete orgUpdates.oidcClientSecret;
      }
    }

    let settings = await getSettings();
    if (Object.keys(orgUpdates).length > 0) {
      if (user.role !== "admin") {
        return NextResponse.json({ error: "Admin access required for org settings" }, { status: 403 });
      }
      settings = await updateSettings(orgUpdates);
    }
    if (Object.keys(userUpdates).length > 0) {
      await updateUserSettings(user.id, userUpdates);
    }

    const effective = await getEffectiveSettings(user.id);

    if (
      Object.prototype.hasOwnProperty.call(userUpdates, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(userUpdates, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(userUpdates, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(orgUpdates, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(orgUpdates, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(orgUpdates, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    if (Object.keys(orgUpdates).length > 0 || Object.keys(userUpdates).length > 0) {
      await auditFromRequest(request, {
        action: AuditAction.SETTINGS_CHANGED,
        actorUserId: user.id,
        actorEmail: user.email,
        targetType: "settings",
        meta: {
          orgKeys: Object.keys(orgUpdates),
          userKeys: Object.keys(userUpdates),
        },
      });
    }

    const { password, oidcClientSecret, ...safeSettings } = effective;
    delete safeSettings._org;
    delete safeSettings._user;
    return NextResponse.json(sanitizeSettings(safeSettings, { oidcClientSecret }), { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
