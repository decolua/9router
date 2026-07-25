import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

function parsePolicy(body) {
  const expiresAt = body.expiresAt || null;
  const tokenLimit = body.tokenLimit === "" || body.tokenLimit == null ? null : Number(body.tokenLimit);
  if (tokenLimit != null && (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1)) throw new Error("Token limit must be a positive whole number");
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) throw new Error("Expiration must be a valid date");
  if (body.allowedModels != null && !Array.isArray(body.allowedModels)) throw new Error("Allowed models must be an array");
  return { expiresAt, tokenLimit, allowedModels: body.allowedModels };
}

export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(body.name.trim(), machineId, parsePolicy(body));
    return NextResponse.json({ key: apiKey.key, name: apiKey.name, id: apiKey.id, machineId: apiKey.machineId }, { status: 201 });
  } catch (error) {
    const status = /Token limit|Expiration|Allowed models/.test(error.message) ? 400 : 500;
    console.log("Error creating key:", error);
    return NextResponse.json({ error: status === 400 ? error.message : "Failed to create key" }, { status });
  }
}
