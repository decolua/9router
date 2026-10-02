import { NextResponse } from "next/server";
import { getRequestDetailById, flushRequestDetailsNow } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details/[id]
 * Returns full unredacted request detail for admin inspection (prompts, messages, responses, error, cost, ip, etc.)
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing detail ID" }, { status: 400 });
    }

    await flushRequestDetailsNow().catch(() => {});
    const detail = await getRequestDetailById(id);
    if (!detail) {
      return NextResponse.json({ error: "Request detail not found" }, { status: 404 });
    }

    return NextResponse.json({ detail });
  } catch (error) {
    console.error("[API] Failed to get request detail by id:", error);
    return NextResponse.json(
      { error: "Failed to fetch request detail" },
      { status: 500 }
    );
  }
}
