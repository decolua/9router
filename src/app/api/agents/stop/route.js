import { NextResponse } from "next/server";
import { stop } from "@/lib/agents/runner";
import { agentsErrorResponse } from "@/lib/agents/http";

export const dynamic = "force-dynamic";

// POST /api/agents/stop - matikan semua slot, atau satu bila ?slot=N / body {slot}
export async function POST(request) {
  try {
    let slot;
    try {
      const body = await request.json();
      slot = body?.slot;
    } catch {
      slot = undefined;
    }
    // Slot tak Given = semua slot (memang tujuannya). Slot yang diberikan tapi
    // bukan integer 1-5 (null/NaN/"abc") dulu jadi falsy -> semua slot mati
    // karena kesalahanSepele. Validasi sama seperti /api/agents/log.
    let n;
    if (slot !== undefined) {
      n = Number(slot);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return NextResponse.json({ error: "slot 1-5" }, { status: 400 });
      }
    }
    const result = stop(n);
    return NextResponse.json(result);
  } catch (error) {
    return agentsErrorResponse(error, "stop");
  }
}
