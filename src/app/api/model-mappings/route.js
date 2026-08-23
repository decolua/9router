import { NextResponse } from "next/server";
import { getModelMappings, setModelMappings, getSettings } from "@/lib/localDb";
import { createModelMappingMap, getMappedModelName } from "@/shared/utils/modelMapping.js";
import { clearModelMappingCatalogCache } from "@/sse/services/modelMappingResolver.js";
import { getModelMappingCatalog } from "@/shared/services/modelMappingCatalog.js";

export const dynamic = "force-dynamic";

async function getCatalog() {
  const [models, mappings, settings] = await Promise.all([
    getModelMappingCatalog(),
    getModelMappings(),
    getSettings(),
  ]);
  const mappingMap = createModelMappingMap(mappings);
  const seen = new Set();
  return models.flatMap((model) => {
    const provider = model.provider;
    const upstreamModel = model.upstreamModel;
    if (!provider || !upstreamModel) return [];
    const id = `${provider}\u0000${upstreamModel}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      provider,
      providerName: settings.providerDisplayNames?.[provider] || model.providerName || provider,
      upstreamModel,
      mappedModel: getMappedModelName(mappingMap, provider, upstreamModel),
    }];
  }).sort((a, b) => a.providerName.localeCompare(b.providerName) || a.upstreamModel.localeCompare(b.upstreamModel));
}

export async function GET() {
  try {
    return NextResponse.json({ mappings: await getCatalog() });
  } catch (error) {
    console.error("[ModelMappings] Failed to load catalog:", error);
    return NextResponse.json({ error: "加载模型映射失败" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const mappings = Array.isArray(body?.mappings) ? body.mappings : [];
    if (!mappings.length) return NextResponse.json({ error: "请选择需要更新的模型" }, { status: 400 });
    const saved = await setModelMappings(mappings);
    clearModelMappingCatalogCache();
    return NextResponse.json({ success: true, updated: saved.length });
  } catch (error) {
    console.error("[ModelMappings] Failed to update mappings:", error);
    return NextResponse.json({ error: "更新模型映射失败" }, { status: 500 });
  }
}
