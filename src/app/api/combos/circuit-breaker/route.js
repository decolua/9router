import { NextResponse } from "next/server";
import { handleSingleModelChat } from "@/sse/handlers/chat.js";
import {
  getComboCircuitConfig,
  getComboCircuitSnapshot,
  runManualComboModelProbe,
} from "open-sse/services/comboCircuitBreaker.js";

export async function GET() {
  return NextResponse.json({
    circuits: getComboCircuitSnapshot({ includeClosed: false }),
    config: getComboCircuitConfig(),
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const model = typeof body?.model === "string" ? body.model.trim() : "";

    if (!model || !model.includes("/")) {
      return NextResponse.json({ error: "A provider/model identifier is required" }, { status: 400 });
    }

    const result = await runManualComboModelProbe(
      model,
      (probeBody) => handleSingleModelChat(
        probeBody,
        model,
        null,
        null,
        null,
        { probeMode: true },
      ),
    );

    return NextResponse.json({
      ...result,
      model,
      testedAt: new Date().toISOString(),
    }, { status: result.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error?.message || "Circuit breaker probe failed",
      testedAt: new Date().toISOString(),
    }, { status: 500 });
  }
}
