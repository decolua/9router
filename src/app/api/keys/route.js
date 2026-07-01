import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getApiKeyUsedTokens } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys (with token usage per window + all-time)
export async function GET() {
  try {
    const keys = await getApiKeys();
    const withUsage = await Promise.all(
      keys.map(async (k) => {
        let usedWindow = 0;       // reset-aware (limit counter)
        let usedWindowActual = 0; // ignores reset (real window usage)
        let usedTotal = 0;        // ignores reset (real all-time)
        try {
          usedWindow = await getApiKeyUsedTokens(k.key, k.limitWindow, k.limitResetAt);
          usedWindowActual = await getApiKeyUsedTokens(k.key, k.limitWindow, null, null, true);
          usedTotal = await getApiKeyUsedTokens(k.key, "total", null, null, true);
        } catch {}
        return { ...k, used: usedWindow, usedWindow, usedWindowActual, usedTotal };
      })
    );
    return NextResponse.json({ keys: withUsage });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, tokenLimit, limitWindow, rpmLimit, allowedModels } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, { tokenLimit, limitWindow, rpmLimit, allowedModels });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      tokenLimit: apiKey.tokenLimit,
      limitWindow: apiKey.limitWindow,
      rpmLimit: apiKey.rpmLimit,
      allowedModels: apiKey.allowedModels,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
