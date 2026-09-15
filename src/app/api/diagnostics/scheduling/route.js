import { NextResponse } from "next/server";
import { snapshotSessionProbe, isSessionProbeEnabled, setSessionProbeEnabled, startSessionProbe } from "open-sse/utils/sessionProbe.js";
import { snapshotLoad, resetLoad } from "open-sse/services/accountLoad.js";
import { snapshotBindings } from "open-sse/services/sessionBindings.js";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/scheduling
 *
 * Read-only observability for the new scheduling layers:
 *   - session identity probe stats (level hit rates, candidate recurrence)
 *   - per-account in-flight load
 *   - session→account binding counts
 *   - the effective scheduling settings
 */
export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      ok: true,
      settings: {
        sessionBindingEnabled: settings.sessionBindingEnabled,
        maxSessionsPerAccount: settings.maxSessionsPerAccount,
        sessionOverflowPolicy: settings.sessionOverflowPolicy,
        sessionIdleTtlMs: settings.sessionIdleTtlMs,
        maxConcurrentPerAccount: settings.maxConcurrentPerAccount,
        schedulingMode: settings.schedulingMode,
        quotaPreferEarlierExpiry: settings.quotaPreferEarlierExpiry,
        quotaWeightRemaining: settings.quotaWeightRemaining,
        quotaWeightExpiry: settings.quotaWeightExpiry,
        sessionProbeEnabled: settings.sessionProbeEnabled,
      },
      sessionProbe: snapshotSessionProbe(),
      accountLoad: snapshotLoad(),
      sessionBindings: snapshotBindings(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

/**
 * POST /api/diagnostics/scheduling
 * Body: { action: "enable-probe" | "disable-probe" | "reset-load" }
 *
 * Minimal control surface for the probe (so it can be toggled without a restart)
 * and for clearing stale in-flight counters during maintenance.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    if (action === "enable-probe" || action === "disable-probe") {
      const enabled = action === "enable-probe";
      setSessionProbeEnabled(enabled);
      if (enabled) startSessionProbe();
      await updateSettings({ sessionProbeEnabled: enabled });
      return NextResponse.json({ ok: true, sessionProbeEnabled: enabled, enabled: isSessionProbeEnabled() });
    }

    if (action === "reset-load") {
      resetLoad();
      return NextResponse.json({ ok: true, accountLoad: snapshotLoad() });
    }

    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
