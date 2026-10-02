import { NextResponse } from "next/server";
import { launch, getConfig } from "@/lib/agents/runner";
import { agentsErrorResponse } from "@/lib/agents/http";

export const dynamic = "force-dynamic";

// POST /api/agents/launch - launch N slot (config opsional di body; selalu restart bersih)
export async function POST(request) {
  try {
    let input;
    try {
      const body = await request.json();
      // Partial config (mis. hanya {task}) di-merge di atas config tersimpan —
      // pengaturan harness/count/model/loop tetap dari awal, tinggal ganti prompt.
      input = body.config ? { ...getConfig(), ...body.config } : undefined;
    } catch {
      input = undefined; // tanpa body = pakai config tersimpan
    }
    const state = launch(input);
    return NextResponse.json({ state });
  } catch (error) {
    return agentsErrorResponse(error, "launch");
  }
}
