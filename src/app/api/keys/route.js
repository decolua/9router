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
 const { name, tokenLimit, resetInterval, allowedModels, rpmLimit, tpmLimit, ipWhitelist, expiresAt, systemPrompt } = body;

 const trimmedName = typeof name === "string" ? name.trim() : "";
 if (!trimmedName) {
 return NextResponse.json({ error: "Name is required" }, { status: 400 });
 }

 // Enforce unique key names — no overwriting or duplicate names
 const existingKeys = await getApiKeys();
 if (existingKeys.some((k) => k.name === trimmedName)) {
 return NextResponse.json({ error: `A key named "${trimmedName}" already exists. Use a different name.` }, { status: 409 });
 }

 // Always get machineId from server
 const machineId = await getConsistentMachineId();
 const apiKey = await createApiKey(trimmedName, machineId, {
 tokenLimit: tokenLimit !== undefined ? Number(tokenLimit) : 0,
 resetInterval: resetInterval || "never",
 allowedModels: allowedModels || "*",
 rpmLimit: rpmLimit !== undefined ? Number(rpmLimit) : 0,
 tpmLimit: tpmLimit !== undefined ? Number(tpmLimit) : 0,
 ipWhitelist: ipWhitelist || "",
 expiresAt: expiresAt || null,
 systemPrompt: systemPrompt || "",
 });


    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      isActive: apiKey.isActive,
      tokenLimit: apiKey.tokenLimit,
      usedTokens: apiKey.usedTokens,
      resetInterval: apiKey.resetInterval,
      lastResetAt: apiKey.lastResetAt,
      allowedModels: apiKey.allowedModels,
      rpmLimit: apiKey.rpmLimit,
      tpmLimit: apiKey.tpmLimit,
      ipWhitelist: apiKey.ipWhitelist,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
