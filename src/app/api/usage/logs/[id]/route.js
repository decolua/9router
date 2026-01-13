import { NextResponse } from "next/server";
import { getLogDetails } from "@/lib/usageDb";

// GET /api/usage/logs/{logId} - Get log details (request/response bodies)
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json({ error: "Log ID is required" }, { status: 400 });
    }

    const details = await getLogDetails(id);
    
    if (!details) {
      return NextResponse.json({ error: "Log not found" }, { status: 404 });
    }
    
    return NextResponse.json(details);
  } catch (error) {
    console.log("Error fetching log details:", error);
    return NextResponse.json({ error: "Failed to fetch log details" }, { status: 500 });
  }
}
