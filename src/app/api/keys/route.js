import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { requireAuth, unauthorizedResponse } from "@/lib/apiAuth.js";
import { sanitizeApiKeyData } from "@/lib/sanitize.js";

// GET /api/keys - List API keys
export async function GET(request) {
  // Require authentication
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return unauthorizedResponse();
  }

  try {
    const keys = await getApiKeys();
    const sanitized = sanitizeApiKeyData(keys);
    return NextResponse.json({ keys: sanitized });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  // Require authentication
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);

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
