import { NextResponse } from "next/server";
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
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, planMonths } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const createOptions = {};
    if (planMonths !== undefined) createOptions.planMonths = planMonths;
    const apiKey = await createApiKey(name, machineId, createOptions);

    return NextResponse.json({ key: apiKey }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    if (error?.message?.startsWith("Plan must be one of")) {
      return NextResponse.json({ error: "Valid planMonths is required" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
