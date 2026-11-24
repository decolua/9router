import { NextResponse } from "next/server";
import { getSettings, updateSettings, getProviderConnections } from "@/lib/localDb";
import { maskConfig, normalizeConfig, readConfig } from "@/shared/services/quotaResetSettings";
import {
  configureQuotaResetNotifier, getRecentNotifications, sendTestNotification,
} from "@/shared/services/quotaResetNotifier";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store" };
const SETTINGS_KEY = "quotaResetNotify";

// The test button posts to saved targets only, never to a URL in the request, so it
// cannot be used to probe arbitrary hosts — this cap just keeps a stuck click or a
// script from hammering a receiver.
const TEST_WINDOW_MS = 60000;
const TEST_MAX_PER_WINDOW = 5;
const g = (global.__quotaResetTestHits ??= []);

function allowTest(now = Date.now()) {
  while (g.length && now - g[0] > TEST_WINDOW_MS) g.shift();
  if (g.length >= TEST_MAX_PER_WINDOW) return false;
  g.push(now);
  return true;
}

async function loadAccounts() {
  const conns = await getProviderConnections({ isActive: true });
  return conns.map((c) => ({
    id: c.id,
    provider: c.provider,
    name: c.name || c.email || c.displayName || `${String(c.id).slice(0, 8)}…`,
  }));
}

async function snapshot() {
  const settings = await getSettings();
  return {
    config: maskConfig(settings[SETTINGS_KEY]),
    accounts: await loadAccounts(),
    recent: getRecentNotifications(),
  };
}

export async function GET() {
  try {
    return NextResponse.json(await snapshot(), { headers: HEADERS });
  } catch (error) {
    console.warn("[QuotaReset] settings read failed:", error.message);
    return NextResponse.json({ error: "Failed to read settings" }, { status: 500, headers: HEADERS });
  }
}

export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: HEADERS });
  }

  let config;
  try {
    const settings = await getSettings();
    config = normalizeConfig(body, settings[SETTINGS_KEY]);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
  }

  try {
    const settings = await updateSettings({ [SETTINGS_KEY]: config });
    configureQuotaResetNotifier(settings);
    return NextResponse.json(await snapshot(), { headers: HEADERS });
  } catch (error) {
    console.warn("[QuotaReset] settings save failed:", error.message);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500, headers: HEADERS });
  }
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    // an empty body means "test every enabled target"
  }
  if (body.action !== "test") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: HEADERS });
  }
  if (!allowTest()) {
    return NextResponse.json({ error: "Too many test sends, try again in a minute" }, { status: 429, headers: HEADERS });
  }

  try {
    const settings = await getSettings();
    const targetId = typeof body.targetId === "string" ? body.targetId : undefined;
    const result = await sendTestNotification(readConfig(settings[SETTINGS_KEY]), targetId);
    return NextResponse.json(result, { headers: HEADERS });
  } catch (error) {
    console.warn("[QuotaReset] test send failed:", error.message);
    return NextResponse.json({ error: "Test send failed" }, { status: 500, headers: HEADERS });
  }
}
