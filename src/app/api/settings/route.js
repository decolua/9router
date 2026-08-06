import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];

const SKIP_RULE_KINDS = new Set(["connect_timeout", "network"]);
const SKIP_RULE_ACTIONS = new Set(["retry", "skip"]);

// Validate maxTransportAttempts + providerSkipRules when present in the PATCH body.
// Returns an error string (→ 400) or null when valid / absent.
function validateSkipRuleSettings(body) {
  if (Object.prototype.hasOwnProperty.call(body, "maxTransportAttempts")) {
    const n = body.maxTransportAttempts;
    if (!Number.isInteger(n) || n < 1 || n > 5) return "maxTransportAttempts must be an integer 1-5";
  }
  if (!Object.prototype.hasOwnProperty.call(body, "providerSkipRules")) return null;

  const rules = body.providerSkipRules;
  if (!Array.isArray(rules)) return "providerSkipRules must be an array";
  if (rules.length > 100) return "providerSkipRules cannot exceed 100 rules";

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const at = `providerSkipRules[${i}]`;
    if (!r || typeof r !== "object") return `${at} must be an object`;
    if (typeof r.provider !== "string" || !r.provider.trim() || r.provider.length > 128) {
      return `${at}.provider must be a non-empty string ≤128 chars`;
    }
    if (!SKIP_RULE_ACTIONS.has(r.action)) return `${at}.action must be "retry" or "skip"`;
    const m = r.match;
    if (!m || typeof m !== "object") return `${at}.match is required`;
    // Match may carry any combination of kind|status|contains; at least one is
    // required, and every present condition must be valid (AND semantics at runtime).
    const present = ["kind", "status", "contains"].filter(k => m[k] != null && m[k] !== "");
    if (present.length < 1) return `${at}.match must have at least one of kind|status|contains`;
    if (m.kind != null && !SKIP_RULE_KINDS.has(m.kind)) return `${at}.match.kind invalid`;
    if (m.status != null && (!Number.isInteger(m.status) || m.status < 100 || m.status > 599)) {
      return `${at}.match.status must be an integer 100-599`;
    }
    if (m.contains != null && m.contains !== "" && (typeof m.contains !== "string" || m.contains.length > 200)) {
      return `${at}.match.contains must be a string ≤200 chars`;
    }
    if (r.headerTimeoutMs != null) {
      if (m.kind !== "connect_timeout") return `${at}.headerTimeoutMs only allowed when match.kind is "connect_timeout"`;
      if (!Number.isInteger(r.headerTimeoutMs) || r.headerTimeoutMs < 1000 || r.headerTimeoutMs > 120000) {
        return `${at}.headerTimeoutMs must be an integer 1000-120000`;
      }
    }
    if (r.sweep != null) {
      if (typeof r.sweep !== "boolean") return `${at}.sweep must be a boolean`;
      if (r.sweep === true && r.action !== "skip") return `${at}.sweep is only allowed when action is "skip"`;
    }
  }
  return null;
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

    // Validate skip-rules feature settings (reject invalid rather than mass-assign blindly)
    const skipRulesError = validateSkipRuleSettings(body);
    if (skipRulesError) {
      return NextResponse.json({ error: skipRulesError }, { status: 400 });
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
