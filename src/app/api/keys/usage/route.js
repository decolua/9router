import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { getApiKeyLimitStatus } from "@/lib/apiKeyLimits.js";

export const dynamic = "force-dynamic";

// GET /api/keys/usage - Current usage vs limits for every API key
export async function GET() {
  try {
    const keys = await getApiKeys();
    const usage = {};
    for (const key of keys) usage[key.id] = await getApiKeyLimitStatus(key);
    return NextResponse.json({ usage });
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
