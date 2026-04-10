import { NextResponse } from "next/server";
import { fetchModelsDevIndex, findModelsDevMetadata } from "@/lib/modelsDevMetadata";

const MAX_MODELS_PER_REQUEST = 500;

export async function POST(request) {
  try {
    const body = await request.json();
    const rawModelIds = Array.isArray(body?.modelIds) ? body.modelIds : [];
    const modelIds = Array.from(
      new Set(
        rawModelIds
          .filter((id) => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean)
          .slice(0, MAX_MODELS_PER_REQUEST),
      ),
    );

    if (modelIds.length === 0) {
      return NextResponse.json({ metadata: {} });
    }

    const modelsDevIndex = await fetchModelsDevIndex();
    const metadata = {};

    for (const modelId of modelIds) {
      const matched = findModelsDevMetadata(modelsDevIndex, modelId);
      if (!matched) continue;
      metadata[modelId] = {
        ...matched,
        ...(matched.context_window !== undefined ? { token_size: matched.context_window } : {}),
      };
    }

    return NextResponse.json({ metadata });
  } catch (error) {
    console.error("[api/models/metadata] Failed to fetch model metadata:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch model metadata" }, { status: 500 });
  }
}
