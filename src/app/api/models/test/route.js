import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

// POST /api/models/test - Ping a single model via internal completions or embeddings
export async function POST(request) {
  try {
    const body = await request.json();
    const { model, modelId, providerId, providerAlias, kind } = body;
    let targetModel = model || modelId;
    if (!targetModel) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const prov = providerAlias || providerId;
    if (prov && !targetModel.includes("/")) {
      const alias = PROVIDER_ID_TO_ALIAS[prov] || prov;
      targetModel = `${alias}/${targetModel}`;
    }

    const host = request.headers.get("host") || `127.0.0.1:${process.env.PORT || 20127}`;
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const baseUrl = `${protocol}://${host}`;

    const result = await pingModelByKind(targetModel, kind || "llm", baseUrl);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
