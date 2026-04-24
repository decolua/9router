import { PROVIDER_MODELS } from "@/shared/constants/models";
import { NextResponse } from "next/server";

/**
 * Handle CORS preflight
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Collect all models from all providers
    const models = [];
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of (providerModels as any[])) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    return NextResponse.json({ models });
  } catch (error: any) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: { message: error.message } }, { status: 500 });
  }
}
