import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getApiKeyDailyUsageSummary } from "@/lib/usageDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

function parseAllowedModels(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map((m) => typeof m === "string" ? m.trim() : "").filter(Boolean)));
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)));
  }
  return [];
}

function parsePolicy(body) {
  const dailyTokenLimit = body.dailyTokenLimit === "" || body.dailyTokenLimit == null ? 0 : Number(body.dailyTokenLimit);
  if (!Number.isInteger(dailyTokenLimit) || dailyTokenLimit < 0) {
    return { error: "dailyTokenLimit must be a non-negative integer" };
  }

  let expiresAt = null;
  if (body.expiresAt) {
    const date = new Date(body.expiresAt);
    if (Number.isNaN(date.getTime())) return { error: "expiresAt must be a valid date" };
    expiresAt = date.toISOString();
  }

  return {
    policy: {
      dailyTokenLimit,
      expiresAt,
      allowedModels: parseAllowedModels(body.allowedModels),
    },
  };
}

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    const keysWithUsage = await Promise.all(
      keys.map(async (key) => ({
        ...key,
        usageToday: await getApiKeyDailyUsageSummary(key),
      }))
    );
    return NextResponse.json({ keys: keysWithUsage });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const parsed = parsePolicy(body);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, parsed.policy);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      dailyTokenLimit: apiKey.dailyTokenLimit,
      expiresAt: apiKey.expiresAt,
      allowedModels: apiKey.allowedModels,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
