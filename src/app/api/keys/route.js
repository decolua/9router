import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, updateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { recordRetentionChange, maskKeyForDisplay } from "@/lib/promptRetention.js";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys. `?retentionEvents=1` appends the recent
// prompt-retention consent change log (newest first, capped ring).
export async function GET(request) {
  try {
    const keys = await getApiKeys();
    if (new URL(request.url).searchParams.get("retentionEvents") === "1") {
      const { getRetentionEvents } = await import("@/lib/promptRetention.js");
      return NextResponse.json({ keys, retentionEvents: getRetentionEvents({ limit: 50 }) });
    }
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
    const { name, promptRetentionEnabled } = body;
    if (Object.hasOwn(body, "promptRetentionEnabled") && typeof promptRetentionEnabled !== "boolean") {
      return NextResponse.json({ error: "promptRetentionEnabled must be a boolean" }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    let apiKey = await createApiKey(name, machineId);
    if (promptRetentionEnabled === true) {
      apiKey = await updateApiKey(apiKey.id, { promptRetentionEnabled });
      recordRetentionChange(apiKey.id, apiKey.name, maskKeyForDisplay(apiKey.key), true, "key-created");
    }

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      promptRetentionEnabled: apiKey.promptRetentionEnabled,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
