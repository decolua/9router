import { NextResponse } from "next/server";
import { exportProviderConfig } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await exportProviderConfig();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting provider config:", error);
    return NextResponse.json({ error: "Failed to export provider config" }, { status: 500 });
  }
}
