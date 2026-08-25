import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { normalizeProviderModelSettings } from "@/lib/providerModelSettings";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];
const USAGE_DEFAULT_PERIODS = new Set(["today", "24h", "7d", "30d"]);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function normalizeProviderModelDescriptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider model descriptions");
  const normalized = {};
  for (const [provider, models] of Object.entries(value)) {
    if (!provider || UNSAFE_OBJECT_KEYS.has(provider) || !models || typeof models !== "object" || Array.isArray(models)) continue;
    const descriptions = {};
    for (const [model, description] of Object.entries(models)) {
      if (!model || UNSAFE_OBJECT_KEYS.has(model) || typeof description !== "string") continue;
      const text = description.trim();
      if (text) descriptions[model] = text.slice(0, 500);
    }
    if (Object.keys(descriptions).length) normalized[provider] = descriptions;
  }
  return normalized;
}

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
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

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    for (const key of ["usageDefaultPeriod", "trafficLogsDefaultPeriod"]) {
      if (Object.prototype.hasOwnProperty.call(body, key) && !USAGE_DEFAULT_PERIODS.has(body[key])) {
        return NextResponse.json({ error: "Invalid default usage period" }, { status: 400 });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "providerModelSettings")) {
      try {
        body.providerModelSettings = normalizeProviderModelSettings(body.providerModelSettings);
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "providerModelDescriptions")) {
      try {
        body.providerModelDescriptions = normalizeProviderModelDescriptions(body.providerModelDescriptions);
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
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

    if (
      Object.prototype.hasOwnProperty.call(body, "pricingAutoSyncEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "pricingAutoSyncIntervalHours")
    ) {
      import("@/shared/services/pricingSync")
        .then(({ configurePricingAutoSync }) => configurePricingAutoSync(settings))
        .catch((error) => console.warn("[Pricing] scheduler update failed:", error.message));
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "providerAutoRecoveryEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "providerAutoRecoveryIntervalMinutes")
    ) {
      import("@/shared/services/providerAutoRecovery")
        .then(({ configureProviderAutoRecovery }) => configureProviderAutoRecovery(settings))
        .catch((error) => console.warn("[ProviderAutoRecovery] scheduler update failed:", error.message));
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
