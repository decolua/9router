import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { getModelKind, getModelsByProviderId } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";

function inferKind(model) {
  const kind = getModelKind(model);
  if (kind) return kind;
  return /image|imagen|dall-?e|flux|sdxl|stable-diffusion/i.test(model.id) ? "image" : "llm";
}

export async function GET() {
  try {
    const connections = await getProviderConnections({ isActive: true });

    return NextResponse.json({
      connections: connections.map((connection) => {
        const catalog = getModelsByProviderId(connection.provider);
        const enabled = connection.providerSpecificData?.enabledModels;
        const rawModels = Array.isArray(enabled) && enabled.length > 0
          ? enabled.map((id) => catalog.find((model) => model.id === id) || { id })
          : catalog;
        const alias = connection.providerSpecificData?.prefix || getProviderAlias(connection.provider);
        const toOption = (model) => ({
          id: `${connection.provider}/${model.id}`,
          label: `${alias}/${model.id}`,
        });
        return {
          id: connection.id,
          provider: connection.provider,
          name: connection.displayName || connection.name || connection.email || connection.id,
          quotaSupported: connection.provider === "codex" || connection.provider === "claude",
          models: rawModels.filter((model) => ["llm", "imageToText"].includes(inferKind(model))).map(toOption),
          imageModels: rawModels.filter((model) => inferKind(model) === "image").map(toOption),
        };
      }),
    });
  } catch (error) {
    console.log("Error fetching API key authorization options:", error);
    return NextResponse.json({ error: "Failed to fetch authorization options" }, { status: 500 });
  }
}
