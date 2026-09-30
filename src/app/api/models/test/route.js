import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const { model, kind, connectionId } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });
    if (connectionId !== undefined && (typeof connectionId !== "string" || !connectionId.trim())) {
      return NextResponse.json({ error: "connectionId must be a non-empty string" }, { status: 400 });
    }
    const result = await pingModelByKind(model, kind || "llm", undefined, connectionId?.trim());
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
