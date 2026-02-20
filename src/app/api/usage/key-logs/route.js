import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getUsageHistory } from "@/lib/usageDb";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

export async function GET(request) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { payload } = await jwtVerify(token, SECRET);
    if (payload?.authType !== "apiKey" || !payload?.apiKeyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get("connectionId") || "";
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || 200)));

    const history = await getUsageHistory({ apiKeyId: payload.apiKeyId });
    const filtered = connectionId
      ? history.filter((entry) => entry.connectionId === connectionId)
      : history;

    const result = filtered
      .slice(-limit)
      .reverse()
      .map((entry) => ({
        timestamp: entry.timestamp,
        provider: entry.provider,
        model: entry.model,
        connectionId: entry.connectionId || null,
        tokens: entry.tokens || null,
      }));

    return NextResponse.json({ items: result });
  } catch (error) {
    console.error("Error fetching key logs:", error);
    return NextResponse.json({ error: "Failed to fetch key logs" }, { status: 500 });
  }
}
