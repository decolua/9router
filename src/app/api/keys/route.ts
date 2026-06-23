import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request: NextRequest, _context: { params: Promise<{}> }) {
  try {
    const body = await request.json() as {
      name?: string;
      role?: string;
      allowedModels?: string[];
      allowedProviders?: string[];
      monthlyTokenLimit?: number;
      monthlyBudgetUsd?: number;
    };
    const { name, role, allowedModels, allowedProviders, monthlyTokenLimit, monthlyBudgetUsd } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const opts: {
      role?: string;
      allowedModels?: string[];
      allowedProviders?: string[];
      monthlyTokenLimit?: number;
      monthlyBudgetUsd?: number;
    } = {};
    if (role !== undefined) opts.role = role;
    if (Array.isArray(allowedModels)) opts.allowedModels = allowedModels;
    if (Array.isArray(allowedProviders)) opts.allowedProviders = allowedProviders;
    if (monthlyTokenLimit !== undefined) opts.monthlyTokenLimit = monthlyTokenLimit;
    if (monthlyBudgetUsd !== undefined) opts.monthlyBudgetUsd = monthlyBudgetUsd;
    const apiKey = await createApiKey(name, machineId, opts);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
