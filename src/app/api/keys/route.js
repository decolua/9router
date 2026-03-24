import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { validateAllowedModelsFormat } from "@/shared/utils/model-pattern-matcher";

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
    const { name, allowedModels } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate allowedModels format if provided
    if (allowedModels !== undefined && allowedModels !== null) {
      const validation = validateAllowedModelsFormat(allowedModels);

      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, allowedModels);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      allowedModels: apiKey.allowedModels,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
