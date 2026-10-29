import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getApiKeyById, getBulkDailyUsage } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateKeyAccessInput, validateLegacyAllowedModels } from "@/shared/utils/keyAccess.js";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    const dailyUsage = await getBulkDailyUsage();
    const keysWithUsage = keys.map((key) => {
      const usage = dailyUsage[key.key] || { requests: 0, cost: 0 };
      return {
        ...key,
        dailyRequests: usage.requests,
        dailySpendUsd: usage.cost,
      };
    });

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
    const { name, maxRequestsPerDay, maxSpendUsdPerDay, access, ...extra } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (maxRequestsPerDay != null && maxSpendUsdPerDay != null) {
      return NextResponse.json(
        { error: "API key cannot have both request limit and spend limit. Choose one." },
        { status: 400 }
      );
    }

    let checkedAccess;
    if (access !== undefined) {
      checkedAccess = validateKeyAccessInput(access);
      if (!checkedAccess.ok) {
        return NextResponse.json({ error: checkedAccess.error }, { status: 400 });
      }
    }
    if (extra.allowedModels !== undefined) {
      const checkedLegacy = validateLegacyAllowedModels(extra.allowedModels);
      if (!checkedLegacy.ok) {
        return NextResponse.json({ error: checkedLegacy.error }, { status: 400 });
      }
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, {
      maxRequestsPerDay,
      maxSpendUsdPerDay,
      ...extra,
      ...(checkedAccess ? { access: checkedAccess.value } : {}),
    });

    // createApiKey's return object is not storage-normalized; the response must come from the persisted row.
    const stored = await getApiKeyById(apiKey.id);
    if (!stored) {
      throw new Error(`Created API key ${apiKey.id} could not be read back from storage`);
    }

    return NextResponse.json({
      key: stored.key,
      id: stored.id,
      name: stored.name,
      machineId: stored.machineId,
      isActive: stored.isActive,
      access: stored.access,
      allowedModels: stored.allowedModels,
      blockedModels: stored.blockedModels,
      allowedCombos: stored.allowedCombos,
      scopes: stored.scopes,
      expiresAt: stored.expiresAt,
      maxRequestsPerDay: stored.maxRequestsPerDay,
      maxSpendUsdPerDay: stored.maxSpendUsdPerDay,
      createdAt: stored.createdAt,
      lastUsedAt: stored.lastUsedAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
