import { NextResponse } from "next/server";
import { getTransferCatalog } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getTransferCatalog());
  } catch (error) {
    console.log("[Transfer] Failed to load catalog:", error.message);
    return NextResponse.json({ error: "Failed to load transferable items" }, { status: 500 });
  }
}
