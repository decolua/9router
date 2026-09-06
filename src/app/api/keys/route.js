import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getBulkDailyUsage } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

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
    const { name, maxRequestsPerDay, maxSpendUsdPerDay, ...extra } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (maxRequestsPerDay != null && maxSpendUsdPerDay != null) {
      return NextResponse.json(
        { error: "API key cannot have both request limit and spend limit. Choose one." },
        { status: 400 }
      );
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, { 
      maxRequestsPerDay, 
      maxSpendUsdPerDay, 
      ...extra 
    });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      ...extra,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
