import { NextResponse } from "next/server";
import { planSelectiveTransfer } from "@/lib/localDb";

export async function POST(request) {
  try {
    const { payload } = await request.json();
    return NextResponse.json(await planSelectiveTransfer(payload));
  } catch (error) {
    console.log("[Transfer] Preview failed:", error.message);
    return NextResponse.json({ error: error.message || "Invalid transfer file" }, { status: 400 });
  }
}
