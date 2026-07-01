import { NextResponse } from "next/server";
import { getUsageByKeyName, getSettings, getModelAliases, getProviderNodes } from "@/lib/localDb";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

export const dynamic = "force-dynamic";

const ALLOWED_PERIODS = ["today", "7d", "30d", "all"];

// POST /api/public/key-usage  { name, password, period }
// Public (no login) lookup of token usage by API key name, gated by a dedicated
// usage-lookup password configured in admin (NOT the admin login password).
// On success returns full detail INCLUDING the API key string and allowed models.
export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, password, period: periodParam } = body || {};

    const settings = await getSettings();
    const expected = (settings.usageLookupPassword || "").trim();

    // Feature is opt-in: disabled until an admin sets a lookup password.
    if (!expected) {
      return NextResponse.json({ error: "Usage lookup is disabled" }, { status: 403 });
    }

    if (typeof password !== "string" || password !== expected) {
      recordFail(ip);
      const post = checkLock(ip);
      if (post.locked) {
        return NextResponse.json(
          { error: `Too many attempts. Try again in ${post.retryAfter}s.`, retryAfter: post.retryAfter },
          { status: 429, headers: { "Retry-After": String(post.retryAfter) } }
        );
      }
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    recordSuccess(ip);

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const period = ALLOWED_PERIODS.includes(periodParam) ? periodParam : null;
    const results = await getUsageByKeyName(name, { period, includeKey: true });
    let aliases = {};
    try { aliases = await getModelAliases(); } catch {}

    // Resolve excluded provider ids to friendly names (custom node name / known provider name).
    const excludedRaw = Array.isArray(settings.tokenLimitExcludedProviders)
      ? settings.tokenLimitExcludedProviders
      : [];
    let excludedProviders = excludedRaw;
    try {
      const nodes = await getProviderNodes();
      const nodeMap = {};
      for (const n of nodes) if (n.id) nodeMap[n.id] = n.name || n.prefix || n.id;
      excludedProviders = excludedRaw.map((id) => ({
        id,
        name: AI_PROVIDERS[id]?.name || nodeMap[id] || id,
      }));
    } catch {
      excludedProviders = excludedRaw.map((id) => ({ id, name: AI_PROVIDERS[id]?.name || id }));
    }

    return NextResponse.json({ name: name.trim(), period, count: results.length, results, aliases, excludedProviders });
  } catch (error) {
    console.log("Error looking up key usage:", error);
    return NextResponse.json({ error: "Failed to look up usage" }, { status: 500 });
  }
}
