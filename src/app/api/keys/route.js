import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "../../../lib/api-keys/plans.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

const KEY_NAME_ERROR = "Name is required";
const KEY_NAME_LENGTH_ERROR = "Name must be 120 characters or fewer";

function parseKeyName(name) {
  if (typeof name !== "string") throw new Error(KEY_NAME_ERROR);
  const trimmed = name.trim();
  if (!trimmed) throw new Error(KEY_NAME_ERROR);
  if (trimmed.length > 120) throw new Error(KEY_NAME_LENGTH_ERROR);
  return trimmed;
}

function keyResponse(apiKey) {
  return {
    key: apiKey.key,
    name: apiKey.name,
    id: apiKey.id,
    machineId: apiKey.machineId,
    isActive: apiKey.isActive,
    planMonths: apiKey.planMonths,
    expiresAt: apiKey.expiresAt,
    deactivatedReason: apiKey.deactivatedReason,
    createdAt: apiKey.createdAt,
    updatedAt: apiKey.updatedAt,
    apiKey,
  };
}

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
    const keyName = parseKeyName(body?.name);

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const createOptions = {};
    if (body?.planMonths !== undefined) createOptions.planMonths = normalizePlanMonths(body.planMonths);
    const apiKey = await createApiKey(keyName, machineId, createOptions);

    return NextResponse.json(keyResponse(apiKey), { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    if (error instanceof SyntaxError || error?.message === KEY_NAME_ERROR || error?.message === KEY_NAME_LENGTH_ERROR) {
      return NextResponse.json({ error: error instanceof SyntaxError ? KEY_NAME_ERROR : error.message }, { status: 400 });
    }
    if (error?.message?.startsWith("Plan must be one of")) {
      return NextResponse.json({ error: "Valid planMonths is required" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
