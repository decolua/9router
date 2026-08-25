import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await buildModelsList(["llm"], { includeDisabled: true });
    return NextResponse.json({ object: "list", data: models });
  } catch (error) {
    console.log("Error fetching dashboard model catalog:", error);
    return NextResponse.json(
      { error: "Failed to fetch model catalog" },
      { status: 500 },
    );
  }
}
