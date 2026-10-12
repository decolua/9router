import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route";

// This route intentionally remains under /api/models so it is protected by
// the dashboard-session guard. The public OpenAI-compatible /v1/models route
// requires an API key, which a browser dashboard must never have to possess.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await buildModelsList(["llm"]);
    return NextResponse.json({ models });
  } catch (error) {
    console.error("Error fetching dashboard model catalog:", error);
    return NextResponse.json(
      { error: "Failed to fetch available models" },
      { status: 500 },
    );
  }
}
