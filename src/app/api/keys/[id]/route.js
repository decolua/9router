import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

const LIMIT_MODES = new Set(["unlimited", "daily", "weekly", "daily_weekly", "hard"]);

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function parseUpdates(body = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
    updates.isActive = body.isActive === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) return { error: "Name is required" };
    updates.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "limitMode")) {
    const mode = String(body.limitMode || "unlimited").toLowerCase();
    if (!LIMIT_MODES.has(mode)) return { error: "Invalid limit mode" };
    updates.limitMode = mode;
  }
  if (Object.prototype.hasOwnProperty.call(body, "tokenLimit")) {
    const limit = parseOptionalPositiveInt(body.tokenLimit);
    if (limit === undefined) return { error: "Invalid token limit" };
    updates.tokenLimit = limit;
  }
  if (Object.prototype.hasOwnProperty.call(body, "dailyTokenLimit")) {
    const limit = parseOptionalPositiveInt(body.dailyTokenLimit);
    if (limit === undefined) return { error: "Invalid daily token limit" };
    updates.dailyTokenLimit = limit;
  }
  if (Object.prototype.hasOwnProperty.call(body, "weeklyTokenLimit")) {
    const limit = parseOptionalPositiveInt(body.weeklyTokenLimit);
    if (limit === undefined) return { error: "Invalid weekly token limit" };
    updates.weeklyTokenLimit = limit;
  }
  if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) {
    if (!body.expiresAt) {
      updates.expiresAt = null;
    } else {
      const expiry = new Date(body.expiresAt);
      if (!Number.isFinite(expiry.getTime())) return { error: "Invalid expiry time" };
      updates.expiresAt = expiry.toISOString();
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "expiresInMs")) {
    const duration = Math.floor(Number(body.expiresInMs));
    if (!Number.isFinite(duration) || duration <= 0) return { error: "Invalid expiry duration" };
    updates.expiresInMs = duration;
  }
  if (Object.prototype.hasOwnProperty.call(body, "autoDeleteExpired")) {
    updates.autoDeleteExpired = body.autoDeleteExpired !== false;
  }

  return { updates };
}

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id, { includeUsage: true });
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const parsed = parseUpdates(body);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const effectiveMode = parsed.updates.limitMode ?? existing.limitMode ?? "unlimited";
    const effectiveLimit = parsed.updates.tokenLimit ?? existing.tokenLimit;
    const effectiveDailyLimit = parsed.updates.dailyTokenLimit ?? existing.dailyTokenLimit;
    const effectiveWeeklyLimit = parsed.updates.weeklyTokenLimit ?? existing.weeklyTokenLimit;
    if (effectiveMode === "daily_weekly" && (!Number.isFinite(Number(effectiveDailyLimit)) || Number(effectiveDailyLimit) <= 0 || !Number.isFinite(Number(effectiveWeeklyLimit)) || Number(effectiveWeeklyLimit) <= 0)) {
      return NextResponse.json({ error: "Daily and weekly token limits are required for daily/weekly mode" }, { status: 400 });
    }
    if (!["unlimited", "daily_weekly"].includes(effectiveMode) && (!Number.isFinite(Number(effectiveLimit)) || Number(effectiveLimit) <= 0)) {
      return NextResponse.json({ error: "Token limit is required for limited keys" }, { status: 400 });
    }

    const updated = await updateApiKey(id, parsed.updates);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
