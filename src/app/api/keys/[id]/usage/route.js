import { NextResponse } from "next/server";
import { resetApiKeyUsage } from "@/lib/localDb";

const PERIODS = new Set(["all", "daily", "weekly"]);

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const period = String(searchParams.get("period") || "all").toLowerCase();
    if (!PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid reset period" }, { status: 400 });
    }

    const result = await resetApiKeyUsage(id, period);
    if (!result) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.log("Error resetting key usage:", error);
    return NextResponse.json({ error: "Failed to reset key usage" }, { status: 500 });
  }
}
