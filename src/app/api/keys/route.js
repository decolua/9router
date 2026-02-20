import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, isCloudEnabled } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { syncToCloud } from "@/app/api/sync/cloud/route";
import { normalizeAllowedModels } from "@/shared/services/apiKeyQuota";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    const enriched = keys.map((k) => {
      const requestLimit = Number(k.requestLimit || 0);
      const tokenLimit = Number(k.tokenLimit || 0);
      const requestUsed = Number(k.requestUsed || 0);
      const tokenUsed = Number(k.tokenUsed || 0);

      return {
        ...k,
        requestRemaining: requestLimit > 0 ? Math.max(0, requestLimit - requestUsed) : null,
        tokenRemaining: tokenLimit > 0 ? Math.max(0, tokenLimit - tokenUsed) : null,
      };
    });

    return NextResponse.json({ keys: enriched });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      ownerName = "",
      ownerEmail = "",
      ownerAge = null,
      requestLimit = 0,
      tokenLimit = 0,
      allowedModels = [],
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const reqLimitNum = Number(requestLimit);
    const tokenLimitNum = Number(tokenLimit);
    const ownerAgeNum = ownerAge === null || ownerAge === "" ? null : Number(ownerAge);

    if (!Number.isFinite(reqLimitNum) || reqLimitNum < 0) {
      return NextResponse.json({ error: "requestLimit must be >= 0" }, { status: 400 });
    }

    if (!Number.isFinite(tokenLimitNum) || tokenLimitNum < 0) {
      return NextResponse.json({ error: "tokenLimit must be >= 0" }, { status: 400 });
    }

    if (ownerAgeNum !== null && (!Number.isFinite(ownerAgeNum) || ownerAgeNum < 0)) {
      return NextResponse.json({ error: "ownerAge must be >= 0" }, { status: 400 });
    }

    if (allowedModels !== undefined && !Array.isArray(allowedModels)) {
      return NextResponse.json({ error: "allowedModels must be an array" }, { status: 400 });
    }

    const normalizedAllowedModels = normalizeAllowedModels(allowedModels);

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, {
      ownerName,
      ownerEmail,
      ownerAge: ownerAgeNum,
      requestLimit: reqLimitNum,
      tokenLimit: tokenLimitNum,
      allowedModels: normalizedAllowedModels,
    });

    // Auto sync to Cloud if enabled
    await syncKeysToCloudIfEnabled();

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      ownerName: apiKey.ownerName,
      ownerEmail: apiKey.ownerEmail,
      ownerAge: apiKey.ownerAge,
      requestLimit: apiKey.requestLimit,
      tokenLimit: apiKey.tokenLimit,
      requestUsed: apiKey.requestUsed,
      tokenUsed: apiKey.tokenUsed,
      allowedModels: apiKey.allowedModels || [],
      requestRemaining: apiKey.requestLimit > 0 ? Math.max(0, apiKey.requestLimit - apiKey.requestUsed) : null,
      tokenRemaining: apiKey.tokenLimit > 0 ? Math.max(0, apiKey.tokenLimit - apiKey.tokenUsed) : null,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}

/**
 * Sync API keys to Cloud if enabled
 */
async function syncKeysToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await syncToCloud(machineId);
  } catch (error) {
    console.log("Error syncing keys to cloud:", error);
  }
}
