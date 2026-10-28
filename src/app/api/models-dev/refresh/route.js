import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/modelsDev/index.js";

export const dynamic = "force-dynamic";

// POST /api/models-dev/refresh - force-refresh the cached models.dev catalog
export async function POST() {
  try {
    const { catalog, fetchedAt } = await getCatalog({ forceRefresh: true });
    return NextResponse.json({
      success: true,
      fetchedAt,
      providerCount: Object.keys(catalog).length,
    });
  } catch (error) {
    console.log("Error refreshing models.dev catalog:", error);
    return NextResponse.json({ error: "Failed to refresh models.dev catalog" }, { status: 502 });
  }
}
