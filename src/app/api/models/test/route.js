import { NextResponse } from "next/server";
import * as log from "@/sse/utils/logger";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const result = await pingModelByKind(model, kind || "llm");
    return NextResponse.json(result);
  } catch (err) {
    log.warn("MODEL_TEST", "Diagnostic model test failed", { error: err?.message });
    return NextResponse.json({ ok: false, error: "Model diagnostic failed" }, { status: 500 });
  }
}
