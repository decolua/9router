import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

const LIMIT_MODES = new Set(["unlimited", "daily", "weekly", "daily_weekly", "hard"]);

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseKeyConfig(body = {}) {
  const limitMode = LIMIT_MODES.has(String(body.limitMode || "unlimited").toLowerCase())
    ? String(body.limitMode || "unlimited").toLowerCase()
    : "unlimited";
  const tokenLimit = parsePositiveInt(body.tokenLimit);
  const dailyTokenLimit = parsePositiveInt(body.dailyTokenLimit);
  const weeklyTokenLimit = parsePositiveInt(body.weeklyTokenLimit);

  if (limitMode === "daily_weekly" && (!dailyTokenLimit || !weeklyTokenLimit)) {
    return { error: "Daily and weekly token limits are required for daily/weekly mode" };
  }
  if (!["unlimited", "daily_weekly"].includes(limitMode) && !tokenLimit) {
    return { error: "Token limit is required for limited keys" };
  }

  let expiresAt = null;
  if (body.expiresAt) {
    const expiry = new Date(body.expiresAt);
    if (!Number.isFinite(expiry.getTime())) return { error: "Invalid expiry time" };
    expiresAt = expiry.toISOString();
  }

  let expiresInMs = null;
  if (body.expiresInMs !== undefined && body.expiresInMs !== null && body.expiresInMs !== "") {
    expiresInMs = Math.floor(Number(body.expiresInMs));
    if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) return { error: "Invalid expiry duration" };
  }

  const config = {
    limitMode,
    tokenLimit: limitMode === "unlimited" || limitMode === "daily_weekly" ? null : tokenLimit,
    dailyTokenLimit: limitMode === "daily_weekly" ? dailyTokenLimit : null,
    weeklyTokenLimit: limitMode === "daily_weekly" ? weeklyTokenLimit : null,
    expiresAt,
    autoDeleteExpired: body.autoDeleteExpired !== false,
  };
  if (expiresInMs !== null) config.expiresInMs = expiresInMs;
  return config;
}

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys({ includeUsage: true });
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const config = parseKeyConfig(body);
    if (config.error) {
      return NextResponse.json({ error: config.error }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, config);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      limitMode: apiKey.limitMode,
      tokenLimit: apiKey.tokenLimit,
      dailyTokenLimit: apiKey.dailyTokenLimit,
      weeklyTokenLimit: apiKey.weeklyTokenLimit,
      expiresAt: apiKey.expiresAt,
      usage: apiKey.usage,
      status: apiKey.status,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
