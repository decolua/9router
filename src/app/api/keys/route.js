import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getAllApiKeyUsageTotals } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const [keys, usageTotals] = await Promise.all([
      getApiKeys(),
      getAllApiKeyUsageTotals(),
    ]);
    const keysWithUsage = keys.map((k) => ({
      ...k,
      usage: usageTotals[k.id] || { totalTokens: 0, totalCost: 0, totalRequests: 0 },
    }));
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
    const { name, allowedModels, maxTokens, maxCostUsd } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const policy = {
      allowedModels: Array.isArray(allowedModels) ? allowedModels : [],
      maxTokens: maxTokens != null ? Number(maxTokens) : null,
      maxCostUsd: maxCostUsd != null ? Number(maxCostUsd) : null,
    };
    const apiKey = await createApiKey(name, machineId, policy);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      policy: apiKey.policy,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
